import { FrameItem, SceneItem } from '../types';
import {
  EXPORT_RESOLUTIONS,
  ExportOptions,
  ExportProgress,
  ExportResult,
  prepareAudioTimeline,
} from './videoExporter';
import type {
  WorkerAudioPayload,
  WorkerFrameEntry,
  WorkerStartPayload,
} from '../workers/videoExporter.worker';

export interface WebCodecsSupportCheck {
  supported: boolean;
  reason?: string;
}

/**
 * AJUSTE C: Feature Detection para WebCodecs
 */
export function checkWebCodecsSupport(): WebCodecsSupportCheck {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Ambiente sem janela de navegador.' };
  }

  if (typeof (window as any).VideoEncoder === 'undefined') {
    return {
      supported: false,
      reason:
        'A API VideoEncoder (WebCodecs) não está disponível neste navegador. Atualize para o Chrome, Edge ou Brave recente.',
    };
  }

  if (typeof (window as any).VideoFrame === 'undefined') {
    return {
      supported: false,
      reason: 'A interface VideoFrame não está disponível.',
    };
  }

  return { supported: true };
}

/**
 * Converte URLs de imagem (data:, blob: ou http:) em Blob
 */
async function fetchImageBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    const parts = src.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binary = atob(parts[1]);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  }

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Falha ao carregar imagem para exportação: ${src.slice(0, 40)}...`);
  }
  return await response.blob();
}

/**
 * Exporta o vídeo através do Dedicated Web Worker com aceleração por hardware,
 * cache de blur otimizado (Ajuste A) e áudio pré-mixado (Ajuste B).
 */
export async function exportRecapWithWorker(
  frames: FrameItem[],
  scenes: SceneItem[],
  options: ExportOptions = {}
): Promise<ExportResult> {
  // 1. AJUSTE C: Verificação de suporte
  const supportCheck = checkWebCodecsSupport();
  if (!supportCheck.supported) {
    throw new Error(supportCheck.reason);
  }

  if (!frames || frames.length === 0) {
    throw new Error('Nenhum quadro selecionado para exportação.');
  }

  const resolutionKey = options.resolution || '16:9';
  const res = EXPORT_RESOLUTIONS[resolutionKey] || EXPORT_RESOLUTIONS['16:9'];
  const width = res.width;
  const height = res.height;
  const fps = options.fps || 30;
  const bitrate = options.bitrate || 5_500_000;
  const includeSubtitles = options.includeSubtitles !== false;
  const signal = options.signal;

  options.onProgress?.({
    currentFrame: 0,
    totalFrames: frames.length,
    percentage: 1,
    message: 'Preparando áudio e imagens para o Worker...',
    elapsedSeconds: 0,
  });

  // 2. AJUSTE B: Preparação e mixagem de áudio na Main Thread (OfflineAudioContext)
  const totalFramesDuration = frames.reduce((acc, f) => acc + Math.max(0.5, f.duration || 3.5), 0);
  const audioTimeline = await prepareAudioTimeline(scenes, frames, totalFramesDuration);

  // Extend last frame if audio lasts longer than the visual frames to avoid cutting speech
  const totalMasterDuration = Math.max(totalFramesDuration, audioTimeline.totalAudioDuration);

  let workerAudio: WorkerAudioPayload | null = null;
  const transferList: Transferable[] = [];

  if (audioTimeline.masterBuffer && options.includeAudio !== false) {
    const mb = audioTimeline.masterBuffer;
    const leftData = mb.getChannelData(0);
    const rightData = mb.numberOfChannels > 1 ? mb.getChannelData(1) : leftData;

    // Create copies to transfer ownership safely
    const leftCopy = new Float32Array(leftData.length);
    leftCopy.set(leftData);
    const rightCopy = new Float32Array(rightData.length);
    rightCopy.set(rightData);

    workerAudio = {
      sampleRate: mb.sampleRate,
      channels: 2,
      leftChannel: leftCopy,
      rightChannel: rightCopy,
    };

    transferList.push(leftCopy.buffer, rightCopy.buffer);
  }

  // 3. Preparar mídias e durações de cada frame
  const workerFrames: WorkerFrameEntry[] = [];
  let currentHead = 0;

  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) {
      throw new Error('Exportação cancelada pelo usuário.');
    }

    const f = frames[i];
    let durSec = Math.max(0.5, f.duration || 3.5);

    // If last frame and audio extends further, stretch it to cover the audio
    if (i === frames.length - 1 && totalMasterDuration > currentHead + durSec) {
      durSec = totalMasterDuration - currentHead;
    }

    const durationFrames = Math.max(1, Math.round(durSec * fps));
    const imageBlob = await fetchImageBlob(f.src);

    // Identify subtitle text from matched scene if available
    const matchedScene = scenes.find(
      (s) =>
        (s.chapterId && f.chapterId && s.pageNumber && f.pageNumber &&
          s.chapterId === f.chapterId && Number(s.pageNumber) === Number(f.pageNumber)) ||
        s.frames?.some((sf) => sf.id === f.id) ||
        (s.pageNumber && f.pageNumber && Number(s.pageNumber) === Number(f.pageNumber))
    );

    workerFrames.push({
      index: i,
      durationFrames,
      durationSeconds: durSec,
      imageBlob,
      subtitleText: (f.narrationSnippet && f.narrationSnippet.trim()) || matchedScene?.text?.trim(),
      transition: f.transition,
    });

    currentHead += durSec;
  }

  // 4. Instanciar Dedicated Web Worker
  const worker = new Worker(
    new URL('../workers/videoExporter.worker.ts', import.meta.url),
    { type: 'module' }
  );

  return new Promise<ExportResult>((resolve, reject) => {
    let hasFinished = false;

    const cleanup = () => {
      hasFinished = true;
      try {
        worker.terminate();
      } catch {}
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        if (!hasFinished) {
          try {
            worker.postMessage({ type: 'CANCEL' });
          } catch {}
          cleanup();
          reject(new Error('Exportação cancelada pelo usuário.'));
        }
      });
    }

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg) return;

      if (msg.type === 'PROGRESS') {
        const p = msg.payload;
        const stageText =
          p.stage === 'muxing'
            ? 'Finalizando arquivo MP4...'
            : `Renderizando a ${p.fps || 60} FPS (${p.currentFrame}/${p.totalFrames})`;

        options.onProgress?.({
          currentFrame: p.currentFrame,
          totalFrames: p.totalFrames,
          percentage: p.percentage,
          message: stageText,
          elapsedSeconds: p.elapsedSeconds,
          estimatedRemainingSeconds: p.estimatedRemainingSeconds,
        });
      } else if (msg.type === 'SUCCESS') {
        const payload = msg.payload;
        cleanup();

        const timestampStr = new Date().toISOString().slice(0, 10);
        const filename = `Recap_Manhwa_${timestampStr}_${resolutionKey}.mp4`;

        resolve({
          blob: payload.mp4Blob,
          filename,
          mimeType: 'video/mp4',
          format: 'mp4',
          duration: payload.durationSeconds,
        });
      } else if (msg.type === 'ERROR') {
        cleanup();
        reject(new Error(msg.payload?.message || 'Erro durante a exportação no Worker.'));
      }
    };

    worker.onerror = (err) => {
      cleanup();
      console.error('[videoExportService] Erro fatal no worker:', err);
      reject(new Error(err.message || 'Erro fatal no Dedicated Web Worker.'));
    };

    // 5. Iniciar pipeline com transferência de buffers
    const startPayload: WorkerStartPayload = {
      width,
      height,
      fps,
      bitrate,
      frames: workerFrames,
      audio: workerAudio,
      includeSubtitles,
    };

    worker.postMessage({ type: 'START', payload: startPayload }, transferList);
  });
}
