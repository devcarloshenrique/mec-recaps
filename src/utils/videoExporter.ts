import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import JSZip from 'jszip';
import { ChapterItem, FrameItem, SceneItem } from '../types';
import { exportRecapWithWorker } from './videoExportService';

export type ExportFormat = 'mp4' | 'webm' | 'shotcut';
export type ExportResolution = '16:9' | '9:16';

export interface ResolutionDetails {
  width: number;
  height: number;
  label: string;
  aspect: string;
  hint: string;
}

export const EXPORT_RESOLUTIONS: Record<ExportResolution, ResolutionDetails> = {
  '16:9': {
    width: 1920,
    height: 1080,
    label: '16:9 Full HD (1920×1080)',
    aspect: '16:9',
    hint: 'Padrão YouTube, Monitores e TVs',
  },
  '9:16': {
    width: 1080,
    height: 1920,
    label: '9:16 Vertical (1080×1920)',
    aspect: '9:16',
    hint: 'YouTube Shorts, TikTok e Instagram Reels',
  },
};

export interface ExportProgress {
  currentFrame: number;
  totalFrames: number;
  percentage: number;
  message: string;
  elapsedSeconds: number;
  estimatedRemainingSeconds?: number;
}

export type ExportProgressCallback = (progress: ExportProgress) => void;

export interface ExportOptions {
  format?: ExportFormat;
  resolution?: ExportResolution;
  fps?: number;
  includeAudio?: boolean;
  includeSubtitles?: boolean;
  bitrate?: number;
  signal?: AbortSignal;
  onProgress?: ExportProgressCallback;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
  format: ExportFormat;
  duration: number;
}

/**
 * Scheduled Audio Clip with strictly non-overlapping timeline bounds
 */
export interface ScheduledAudioClip {
  sceneId: string;
  sceneTitle: string;
  chapterId?: string;
  pageNumber?: number;
  text?: string;
  decodedBuffer: AudioBuffer;
  duration: number; // in seconds
  startTime: number; // timeline start in seconds (zero overlap guarantee)
  endTime: number;
  audioBlob?: Blob;
  audioUrl?: string;
}

export interface PreparedAudioTimeline {
  masterBuffer: AudioBuffer | null;
  scheduledClips: ScheduledAudioClip[];
  totalAudioDuration: number;
}

/**
 * Sequential Frame Loader with sliding window cache (max 2 frames in memory).
 * Releases previous ImageBitmaps and revokes ObjectURLs to avoid memory bloat / leaks.
 */
export class SequentialFrameLoader {
  private frames: FrameItem[];
  private cache = new Map<number, { bitmap: ImageBitmap | HTMLImageElement; close: () => void }>();
  private temporaryUrls = new Set<string>();

  constructor(frames: FrameItem[]) {
    this.frames = frames;
  }

  async getFrameImage(index: number): Promise<{ bitmap: ImageBitmap | HTMLImageElement; close: () => void }> {
    if (this.cache.has(index)) {
      return this.cache.get(index)!;
    }

    // Free frames outside of [index - 1, index + 1]
    for (const [key, item] of this.cache.entries()) {
      if (key < index - 1 || key > index + 1) {
        item.close();
        this.cache.delete(key);
      }
    }

    const frame = this.frames[index];
    if (!frame) {
      throw new Error(`Quadro de índice ${index} não encontrado.`);
    }

    let blob = frame.blob;
    if (!blob) {
      if (frame.src.startsWith('blob:') || frame.src.startsWith('data:')) {
        try {
          const resp = await fetch(frame.src);
          blob = await resp.blob();
        } catch {
          // fallback to HTMLImageElement
        }
      }
    }

    let item: { bitmap: ImageBitmap | HTMLImageElement; close: () => void };

    if (blob && typeof createImageBitmap !== 'undefined') {
      try {
        const bmp = await createImageBitmap(blob);
        item = {
          bitmap: bmp,
          close: () => {
            try {
              bmp.close();
            } catch {}
          },
        };
      } catch {
        item = await this.loadImgElement(frame.src);
      }
    } else {
      item = await this.loadImgElement(frame.src);
    }

    this.cache.set(index, item);

    // Asynchronously preload next frame in background
    if (index + 1 < this.frames.length && !this.cache.has(index + 1)) {
      this.preload(index + 1).catch(() => {});
    }

    return item;
  }

  private async preload(nextIndex: number) {
    const frame = this.frames[nextIndex];
    if (!frame) return;
    let blob = frame.blob;
    if (!blob && (frame.src.startsWith('blob:') || frame.src.startsWith('data:'))) {
      try {
        const resp = await fetch(frame.src);
        blob = await resp.blob();
      } catch {}
    }

    if (blob && typeof createImageBitmap !== 'undefined') {
      try {
        const bmp = await createImageBitmap(blob);
        this.cache.set(nextIndex, {
          bitmap: bmp,
          close: () => {
            try {
              bmp.close();
            } catch {}
          },
        });
      } catch {}
    }
  }

  private loadImgElement(src: string): Promise<{ bitmap: HTMLImageElement; close: () => void }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        resolve({
          bitmap: img,
          close: () => {
            img.src = '';
          },
        });
      };
      img.onerror = () => reject(new Error('Falha ao carregar textura do quadro.'));
      img.src = src;
    });
  }

  destroy() {
    for (const item of this.cache.values()) {
      item.close();
    }
    this.cache.clear();
    for (const url of this.temporaryUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {}
    }
    this.temporaryUrls.clear();
  }
}

/**
 * Draws a single timeline video frame with blurred background + contained foreground + motion + subtitles
 */
export function drawRecapFrame({
  ctx,
  width,
  height,
  img,
  progress,
  subtitleText,
  includeSubtitles = true,
}: {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  img: ImageBitmap | HTMLImageElement;
  progress: number; // 0.0 to 1.0 within this frame's duration
  subtitleText?: string;
  includeSubtitles?: boolean;
}) {
  ctx.save();

  // 1. Dark base
  ctx.fillStyle = '#08090c';
  ctx.fillRect(0, 0, width, height);

  const imgW = img.width || 800;
  const imgH = img.height || 1200;

  // 2. Background Layer: Blurred Pillarbox/Letterbox Cover
  ctx.save();
  const bgScale = Math.max(width / imgW, height / imgH) * 1.14;
  const bgW = imgW * bgScale;
  const bgH = imgH * bgScale;
  const bgX = (width - bgW) / 2;
  const bgY = (height - bgH) / 2;

  ctx.filter = 'blur(24px) brightness(0.55)';
  ctx.drawImage(img, bgX, bgY, bgW, bgH);
  ctx.filter = 'none';

  // Vignette overlay
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.25,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.8
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0.1)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // 3. Foreground Layer: Sangria Permanente (Overbleed), borda de 7px e zoom suave
  ctx.save();
  const imgAspect = imgW / imgH;
  const canvasAspect = width / height;
  const isPortraitDominant = imgAspect < canvasAspect;

  let baseW: number;
  let baseH: number;
  if (isPortraitDominant) {
    baseH = height * 1.045;
    baseW = baseH * imgAspect;
  } else {
    baseW = width * 1.045;
    baseH = baseW / imgAspect;
  }

  const zoomFactor = 1.0 + 0.04 * progress;
  const mainW = baseW * zoomFactor;
  const mainH = baseH * zoomFactor;
  const mainX = (width - mainW) / 2;
  const mainY = (height - mainH) / 2;

  // Cinematic drop shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = Math.round(width * 0.018);
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = Math.round(height * 0.006);

  ctx.drawImage(img, mainX, mainY, mainW, mainH);
  ctx.restore();

  // Borda branca mais espessa (7px em 1080p)
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
  ctx.lineWidth = Math.max(6, Math.round(width * 0.0036));
  ctx.strokeRect(mainX, mainY, mainW, mainH);
  ctx.restore();

  // 4. Subtitles Layer
  if (includeSubtitles && subtitleText && subtitleText.trim()) {
    drawSubtitlesPill(ctx, width, height, subtitleText.trim());
  }

  ctx.restore();
}

/**
 * Draws rounded pill subtitle with word-wrap
 */
function drawSubtitlesPill(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  text: string
) {
  ctx.save();
  const fontSize = Math.max(22, Math.round(height * 0.034));
  ctx.font = `600 ${fontSize}px sans-serif, system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxTextWidth = width * 0.82;
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.35;
  const totalBoxHeight = lines.length * lineHeight + 22;
  const boxY = height - totalBoxHeight - height * 0.055;

  const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxWidth = Math.min(width * 0.88, maxLineWidth + 44);
  const boxX = (width - boxWidth) / 2;

  // Background pill
  ctx.fillStyle = 'rgba(12, 14, 18, 0.88)';
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(boxX, boxY, boxWidth, totalBoxHeight, 12);
  } else {
    ctx.rect(boxX, boxY, boxWidth, totalBoxHeight);
  }
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 5;

  lines.forEach((line, idx) => {
    const lineY = boxY + 14 + (idx + 0.5) * lineHeight;
    ctx.fillText(line, width / 2, lineY);
  });

  ctx.restore();
}

/**
 * Prepares the audio timeline with strict non-overlapping sequential scheduling
 * and exact timeline page-alignment.
 */
export async function prepareAudioTimeline(
  scenes: SceneItem[],
  frames: FrameItem[],
  totalFramesSeconds: number
): Promise<PreparedAudioTimeline> {
  const scenesWithAudio = scenes.filter((s) => s.audioBlob || s.audioUrl);
  if (scenesWithAudio.length === 0) {
    return { masterBuffer: null, scheduledClips: [], totalAudioDuration: 0 };
  }

  // 1. Build exact timing for all frames on the timeline
  let cursor = 0;
  const frameTiming: {
    id: string;
    chapterId: string;
    pageNumber: number;
    startTime: number;
    duration: number;
  }[] = [];

  const pageStartTimeMap = new Map<string, number>();
  const pageNumberFirstSeen = new Map<number, number>();

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const dur = Math.max(0.5, f.duration || 3.5);
    const chId = f.chapterId || 'default_ch';
    const pNum = f.pageNumber || 1;
    const startTime = cursor;

    frameTiming.push({
      id: f.id,
      chapterId: chId,
      pageNumber: pNum,
      startTime,
      duration: dur,
    });

    const pageKey = `${chId}_${pNum}`;
    if (!pageStartTimeMap.has(pageKey)) {
      pageStartTimeMap.set(pageKey, startTime);
    }
    if (!pageNumberFirstSeen.has(pNum)) {
      pageNumberFirstSeen.set(pNum, startTime);
    }

    cursor += dur;
  }

  // 2. Decode each audio clip and identify ideal start time
  const sampleRate = 44100;
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    2,
    44100,
    sampleRate
  );

  const rawClips: {
    scene: SceneItem;
    decodedBuffer: AudioBuffer;
    duration: number;
    idealStartTime: number;
  }[] = [];

  // Deduplicate scenes by id or audioUrl to avoid duplicate simultaneous tracks
  const seenSceneIds = new Set<string>();
  const seenUrls = new Set<string>();

  for (let i = 0; i < scenesWithAudio.length; i++) {
    const sc = scenesWithAudio[i];
    if (seenSceneIds.has(sc.id)) continue;
    if (sc.audioUrl && seenUrls.has(sc.audioUrl)) continue;

    try {
      let arrayBuf: ArrayBuffer;
      if (sc.audioBlob) {
        arrayBuf = await sc.audioBlob.arrayBuffer();
      } else {
        const resp = await fetch(sc.audioUrl!);
        arrayBuf = await resp.arrayBuffer();
      }

      const decoded = await offlineCtx.decodeAudioData(arrayBuf);
      if (decoded && decoded.duration > 0.05) {
        seenSceneIds.add(sc.id);
        if (sc.audioUrl) seenUrls.add(sc.audioUrl);

        // Calculate idealStartTime matching page / frame on timeline
        let idealStartTime = -1;

        if (sc.frames && sc.frames.length > 0) {
          for (const sf of sc.frames) {
            const match = frameTiming.find((ft) => ft.id === sf.id);
            if (match && (idealStartTime === -1 || match.startTime < idealStartTime)) {
              idealStartTime = match.startTime;
            }
          }
        }

        if (idealStartTime === -1 && sc.chapterId && sc.pageNumber) {
          const pageKey = `${sc.chapterId}_${sc.pageNumber}`;
          if (pageStartTimeMap.has(pageKey)) {
            idealStartTime = pageStartTimeMap.get(pageKey)!;
          }
        }

        if (idealStartTime === -1 && sc.pageNumber && pageNumberFirstSeen.has(sc.pageNumber)) {
          idealStartTime = pageNumberFirstSeen.get(sc.pageNumber)!;
        }

        if (idealStartTime === -1) {
          idealStartTime = (i / Math.max(1, scenesWithAudio.length)) * totalFramesSeconds;
        }

        rawClips.push({
          scene: sc,
          decodedBuffer: decoded,
          duration: decoded.duration,
          idealStartTime,
        });
      }
    } catch (err) {
      console.warn(`Aviso ao decodificar áudio da cena ${sc.id}:`, err);
    }
  }

  if (rawClips.length === 0) {
    return { masterBuffer: null, scheduledClips: [], totalAudioDuration: 0 };
  }

  // 3. Sort clips strictly by ideal start time
  rawClips.sort((a, b) => a.idealStartTime - b.idealStartTime);

  // 4. ANTI-OVERLAP SEQUENTIAL SCHEDULING (Zero-Overlap Guarantee!)
  const scheduledClips: ScheduledAudioClip[] = [];
  let lastAudioEnd = 0;

  for (let i = 0; i < rawClips.length; i++) {
    const item = rawClips[i];
    // Guarantee that this clip starts AFTER the previous clip finishes + 0.25s silence
    const minSafeStartTime = lastAudioEnd > 0 ? lastAudioEnd + 0.25 : 0;
    const scheduledStart = Math.max(item.idealStartTime, minSafeStartTime);
    const scheduledEnd = scheduledStart + item.duration;

    scheduledClips.push({
      sceneId: item.scene.id,
      sceneTitle: item.scene.title || `Cena ${i + 1}`,
      chapterId: item.scene.chapterId,
      pageNumber: item.scene.pageNumber,
      text: item.scene.text,
      decodedBuffer: item.decodedBuffer,
      duration: item.duration,
      startTime: scheduledStart,
      endTime: scheduledEnd,
      audioBlob: item.scene.audioBlob,
      audioUrl: item.scene.audioUrl,
    });

    lastAudioEnd = scheduledEnd;
  }

  // 5. Render Master Soundtrack Buffer via OfflineAudioContext
  const totalMasterDuration = Math.max(totalFramesSeconds, lastAudioEnd + 0.5);
  const totalSamples = Math.ceil(totalMasterDuration * sampleRate);

  const masterOfflineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    2,
    Math.max(sampleRate, totalSamples),
    sampleRate
  );

  for (const clip of scheduledClips) {
    const source = masterOfflineCtx.createBufferSource();
    source.buffer = clip.decodedBuffer;
    source.connect(masterOfflineCtx.destination);
    source.start(clip.startTime);
  }

  try {
    const masterBuffer = await masterOfflineCtx.startRendering();
    return {
      masterBuffer,
      scheduledClips,
      totalAudioDuration: totalMasterDuration,
    };
  } catch (err) {
    console.error('Erro ao renderizar trilha master de áudio:', err);
    return { masterBuffer: null, scheduledClips, totalAudioDuration: totalMasterDuration };
  }
}

/**
 * Format 1: High-Performance MP4 Renderer via WebCodecs + mp4-muxer
 */
export async function renderMP4WithWebCodecs({
  frames,
  scenes,
  resolution = '16:9',
  fps = 30,
  includeAudio = true,
  includeSubtitles = true,
  bitrate = 6_000_000,
  signal,
  onProgress,
}: ExportOptions & { frames: FrameItem[]; scenes: SceneItem[] }): Promise<ExportResult> {
  if (frames.length === 0) {
    throw new Error('Nenhum quadro na timeline para exportar.');
  }

  // Check WebCodecs VideoEncoder support
  if (
    typeof window === 'undefined' ||
    typeof (window as any).VideoEncoder === 'undefined' ||
    typeof (window as any).VideoFrame === 'undefined'
  ) {
    throw new Error('Seu navegador não possui suporte ao WebCodecs VideoEncoder. Utilize o formato WebM.');
  }

  const res = EXPORT_RESOLUTIONS[resolution] || EXPORT_RESOLUTIONS['16:9'];
  const width = Math.floor(res.width / 2) * 2;
  const height = Math.floor(res.height / 2) * 2;

  // Calculate base durations from frames
  const durations = frames.map((f) => Math.max(1, f.duration || 3.5));
  const totalFramesDuration = durations.reduce((a, b) => a + b, 0);

  // Prepare offline master audio with zero overlap
  let audioTimeline: PreparedAudioTimeline | null = null;
  let masterAudioBuffer: AudioBuffer | null = null;
  let hasAudioTrack = false;

  if (includeAudio) {
    onProgress?.({
      currentFrame: 0,
      totalFrames: Math.round(totalFramesDuration * fps),
      percentage: 2,
      message: 'Organizando e mixando trilha de áudio sem sobreposição...',
      elapsedSeconds: 0,
    });
    audioTimeline = await prepareAudioTimeline(scenes, frames, totalFramesDuration);
    masterAudioBuffer = audioTimeline.masterBuffer;
  }

  // Ensure total video length covers all narration audio
  const totalSeconds = audioTimeline?.totalAudioDuration
    ? Math.max(totalFramesDuration, audioTimeline.totalAudioDuration)
    : totalFramesDuration;
  const totalFramesCount = Math.round(totalSeconds * fps);

  // Check AudioEncoder support
  const isAudioEncoderSupported =
    typeof (window as any).AudioEncoder !== 'undefined' &&
    typeof (window as any).AudioData !== 'undefined';

  if (masterAudioBuffer && isAudioEncoderSupported) {
    try {
      const support = await (window as any).AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        numberOfChannels: 2,
        sampleRate: 44100,
        bitrate: 128_000,
      });
      hasAudioTrack = !!support.supported;
    } catch {
      hasAudioTrack = false;
    }
  }

  // Initialize mp4-muxer
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: fps,
    },
    audio: hasAudioTrack
      ? {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: 44100,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  });

  // Choose supported H.264 codec string
  const videoEncoderConfigs = [
    { codec: 'avc1.42E01E', width, height, bitrate, framerate: fps },
    { codec: 'avc1.4d002a', width, height, bitrate, framerate: fps },
    { codec: 'avc1.42001f', width, height, bitrate, framerate: fps },
  ];

  let selectedCodecConfig = videoEncoderConfigs[0];
  for (const cfg of videoEncoderConfigs) {
    try {
      const support = await (window as any).VideoEncoder.isConfigSupported(cfg);
      if (support.supported) {
        selectedCodecConfig = cfg;
        break;
      }
    } catch {}
  }

  const videoEncoder = new (window as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: any) => console.error('Erro no VideoEncoder:', e),
  });

  videoEncoder.configure(selectedCodecConfig);

  // Initialize AudioEncoder if supported and audio track is present
  let audioEncoder: any = null;
  if (hasAudioTrack && masterAudioBuffer) {
    audioEncoder = new (window as any).AudioEncoder({
      output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
      error: (e: any) => console.error('Erro no AudioEncoder:', e),
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      numberOfChannels: 2,
      sampleRate: 44100,
      bitrate: 128_000,
    });

    // Feed audio chunks in background
    const chunkSize = 1024;
    const totalSamples = masterAudioBuffer.length;
    const left = masterAudioBuffer.getChannelData(0);
    const right = masterAudioBuffer.numberOfChannels > 1 ? masterAudioBuffer.getChannelData(1) : left;

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      if (signal?.aborted) break;
      const framesInChunk = Math.min(chunkSize, totalSamples - offset);
      const planar = new Float32Array(framesInChunk * 2);
      planar.set(left.subarray(offset, offset + framesInChunk), 0);
      planar.set(right.subarray(offset, offset + framesInChunk), framesInChunk);

      const audioData = new (window as any).AudioData({
        format: 'f32-planar',
        sampleRate: 44100,
        numberOfFrames: framesInChunk,
        numberOfChannels: 2,
        timestamp: Math.round((offset / 44100) * 1_000_000),
        data: planar,
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }
  }

  // Setup Offscreen Canvas
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;

  // Initialize sequential memory-safe loader
  const frameLoader = new SequentialFrameLoader(frames);

  const startTimeMs = performance.now();
  let currentFrameIndex = 0;
  let accumulatedTime = 0;

  try {
    for (let f = 0; f < totalFramesCount; f++) {
      if (signal?.aborted) {
        throw new Error('Renderização cancelada.');
      }

      const currentTime = f / fps;

      while (
        currentFrameIndex < frames.length - 1 &&
        currentTime >= accumulatedTime + durations[currentFrameIndex]
      ) {
        accumulatedTime += durations[currentFrameIndex];
        currentFrameIndex++;
      }

      const frameDuration = durations[currentFrameIndex];
      const frameElapsed = Math.max(0, currentTime - accumulatedTime);
      const frameProgress = Math.min(1, Math.max(0, frameElapsed / frameDuration));

      // Load image on-demand (sliding window)
      const { bitmap } = await frameLoader.getFrameImage(currentFrameIndex);

      // Find subtitle perfectly synchronized with active spoken audio clip
      let subtitleText = '';
      if (includeSubtitles && audioTimeline?.scheduledClips) {
        const activeClip = audioTimeline.scheduledClips.find(
          (c) => currentTime >= c.startTime && currentTime <= c.endTime + 0.35
        );
        if (activeClip && activeClip.text) {
          subtitleText = activeClip.text;
        }
      }

      // Draw canvas
      drawRecapFrame({
        ctx,
        width,
        height,
        img: bitmap,
        progress: frameProgress,
        subtitleText,
        includeSubtitles,
      });

      // VideoFrame conversion & encoding
      const timestampMicros = Math.round(currentTime * 1_000_000);
      const videoFrame = new (window as any).VideoFrame(canvas, {
        timestamp: timestampMicros,
        duration: Math.round((1 / fps) * 1_000_000),
      });

      const isKeyFrame = f % (fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      // Report progress periodically without stalling the UI
      if (f % 12 === 0 || f === totalFramesCount - 1) {
        const elapsedSec = (performance.now() - startTimeMs) / 1000;
        const pct = Math.round(((f + 1) / totalFramesCount) * 100);
        const fpsRate = (f + 1) / Math.max(0.1, elapsedSec);
        const remFrames = totalFramesCount - (f + 1);
        const estRemSec = Math.round(remFrames / Math.max(1, fpsRate));

        onProgress?.({
          currentFrame: f + 1,
          totalFrames: totalFramesCount,
          percentage: pct,
          message: `Renderizando frame ${f + 1} de ${totalFramesCount} (${fpsRate.toFixed(1)} fps)`,
          elapsedSeconds: Math.round(elapsedSec),
          estimatedRemainingSeconds: estRemSec,
        });

        // Yield to browser event loop
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    onProgress?.({
      currentFrame: totalFramesCount,
      totalFrames: totalFramesCount,
      percentage: 98,
      message: 'Finalizando multiplexação do arquivo MP4...',
      elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
    });

    await videoEncoder.flush();
    videoEncoder.close();

    if (audioEncoder) {
      await audioEncoder.flush();
      audioEncoder.close();
    }

    muxer.finalize();
    const finalBlob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Recap_MP4_${width}x${height}_${dateStr}.mp4`;

    return {
      blob: finalBlob,
      filename,
      mimeType: 'video/mp4',
      format: 'mp4',
      duration: totalSeconds,
    };
  } finally {
    frameLoader.destroy();
  }
}

/**
 * Format 2: Universal WebM Renderer via MediaRecorder API (fallback)
 */
export async function renderWebM({
  frames,
  scenes,
  resolution = '16:9',
  fps = 30,
  includeAudio = true,
  includeSubtitles = true,
  bitrate = 5_000_000,
  signal,
  onProgress,
}: ExportOptions & { frames: FrameItem[]; scenes: SceneItem[] }): Promise<ExportResult> {
  if (frames.length === 0) {
    throw new Error('Nenhum quadro na timeline para exportar.');
  }

  const res = EXPORT_RESOLUTIONS[resolution] || EXPORT_RESOLUTIONS['16:9'];
  const width = Math.floor(res.width / 2) * 2;
  const height = Math.floor(res.height / 2) * 2;

  const durations = frames.map((f) => Math.max(1, f.duration || 3.5));
  const totalFramesDuration = durations.reduce((a, b) => a + b, 0);

  // Master audio with non-overlapping timeline
  let audioTimeline: PreparedAudioTimeline | null = null;
  let masterAudioBuffer: AudioBuffer | null = null;

  if (includeAudio) {
    onProgress?.({
      currentFrame: 0,
      totalFrames: Math.round(totalFramesDuration * fps),
      percentage: 2,
      message: 'Preparando áudio da narração sem sobreposição...',
      elapsedSeconds: 0,
    });
    audioTimeline = await prepareAudioTimeline(scenes, frames, totalFramesDuration);
    masterAudioBuffer = audioTimeline.masterBuffer;
  }

  const totalSeconds = audioTimeline?.totalAudioDuration
    ? Math.max(totalFramesDuration, audioTimeline.totalAudioDuration)
    : totalFramesDuration;
  const totalFramesCount = Math.round(totalSeconds * fps);

  // Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Stream & Audio Routing
  const stream = canvas.captureStream(fps);
  let audioCtx: AudioContext | null = null;
  let sourceNode: AudioBufferSourceNode | null = null;

  if (masterAudioBuffer) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    const dest = audioCtx.createMediaStreamDestination();
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = masterAudioBuffer;
    sourceNode.connect(dest);
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
    }
  }

  const mimeType =
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m)
    ) || 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const frameLoader = new SequentialFrameLoader(frames);
  const startTimeMs = performance.now();

  return new Promise<ExportResult>((resolve, reject) => {
    recorder.onstop = () => {
      frameLoader.destroy();
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
      const finalBlob = new Blob(chunks, { type: 'video/webm' });
      const dateStr = new Date().toISOString().slice(0, 10);
      resolve({
        blob: finalBlob,
        filename: `Recap_WebM_${width}x${height}_${dateStr}.webm`,
        mimeType: 'video/webm',
        format: 'webm',
        duration: totalSeconds,
      });
    };

    recorder.onerror = (e) => {
      frameLoader.destroy();
      if (audioCtx) audioCtx.close().catch(() => {});
      reject(new Error(`Erro no MediaRecorder: ${e}`));
    };

    recorder.start(1000);
    if (sourceNode) {
      sourceNode.start(0);
    }

    let currentFrameIndex = 0;
    let accumulatedTime = 0;
    const frameIntervalMs = 1000 / fps;

    let f = 0;
    const processNextFrame = async () => {
      if (signal?.aborted) {
        recorder.stop();
        frameLoader.destroy();
        if (audioCtx) audioCtx.close().catch(() => {});
        reject(new Error('Renderização cancelada.'));
        return;
      }

      if (f >= totalFramesCount) {
        onProgress?.({
          currentFrame: totalFramesCount,
          totalFrames: totalFramesCount,
          percentage: 99,
          message: 'Finalizando gravação WebM...',
          elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
        });
        setTimeout(() => recorder.stop(), 250);
        return;
      }

      const currentTime = f / fps;

      while (
        currentFrameIndex < frames.length - 1 &&
        currentTime >= accumulatedTime + durations[currentFrameIndex]
      ) {
        accumulatedTime += durations[currentFrameIndex];
        currentFrameIndex++;
      }

      const frameDuration = durations[currentFrameIndex];
      const frameElapsed = Math.max(0, currentTime - accumulatedTime);
      const frameProgress = Math.min(1, Math.max(0, frameElapsed / frameDuration));

      try {
        const { bitmap } = await frameLoader.getFrameImage(currentFrameIndex);

        let subtitleText = '';
        if (includeSubtitles && audioTimeline?.scheduledClips) {
          const activeClip = audioTimeline.scheduledClips.find(
            (c) => currentTime >= c.startTime && currentTime <= c.endTime + 0.35
          );
          if (activeClip && activeClip.text) {
            subtitleText = activeClip.text;
          }
        }

        drawRecapFrame({
          ctx,
          width,
          height,
          img: bitmap,
          progress: frameProgress,
          subtitleText,
          includeSubtitles,
        });

        if (f % 10 === 0 || f === totalFramesCount - 1) {
          const elapsedSec = (performance.now() - startTimeMs) / 1000;
          const pct = Math.round(((f + 1) / totalFramesCount) * 100);
          onProgress?.({
            currentFrame: f + 1,
            totalFrames: totalFramesCount,
            percentage: pct,
            message: `Gravando WebM: frame ${f + 1} de ${totalFramesCount}`,
            elapsedSeconds: Math.round(elapsedSec),
          });
        }

        f++;
        setTimeout(processNextFrame, frameIntervalMs * 0.7);
      } catch (err) {
        recorder.stop();
        frameLoader.destroy();
        reject(err);
      }
    };

    processNextFrame();
  });
}

/**
 * Format 3: Shotcut Project Generator (.mlt XML + ZIP package)
 */
export async function generateShotcutMLT({
  frames,
  scenes,
  chapters = [],
  resolution = '16:9',
  fps = 30,
  signal,
  onProgress,
}: ExportOptions & {
  frames: FrameItem[];
  scenes: SceneItem[];
  chapters?: ChapterItem[];
}): Promise<ExportResult> {
  if (frames.length === 0) {
    throw new Error('Nenhum quadro na timeline para gerar projeto Shotcut.');
  }

  const res = EXPORT_RESOLUTIONS[resolution] || EXPORT_RESOLUTIONS['16:9'];
  const width = res.width;
  const height = res.height;
  const aspectNum = resolution === '16:9' ? 16 : 9;
  const aspectDen = resolution === '16:9' ? 9 : 16;

  const zip = new JSZip();
  const mediaFolder = zip.folder('media') || zip;

  const startTimeMs = performance.now();
  onProgress?.({
    currentFrame: 0,
    totalFrames: frames.length,
    percentage: 5,
    message: 'Coletando imagens e áudios para o pacote Shotcut...',
    elapsedSeconds: 0,
  });

  // 1. Save frame images to media folder
  const frameMediaEntries: {
    index: number;
    filename: string;
    durationFrames: number;
    durationSeconds: number;
    rect: string;
  }[] = [];

  for (let i = 0; i < frames.length; i++) {
    if (signal?.aborted) throw new Error('Exportação cancelada.');
    const frame = frames[i];
    const durationSeconds = Math.max(1, frame.duration || 3.5);
    const durationFrames = Math.round(durationSeconds * fps);
    const filename = `quadro_${String(i + 1).padStart(3, '0')}.jpg`;

    let blob = frame.blob;
    if (!blob) {
      try {
        const resp = await fetch(frame.src);
        blob = await resp.blob();
      } catch {
        // Fallback placeholder blob
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);
        blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg'));
      }
    }

    mediaFolder.file(filename, blob);

    let aspect = (frame as { aspectRatio?: number }).aspectRatio;
    if (!aspect && typeof Image !== 'undefined') {
      try {
        const img = new Image();
        img.src = frame.src;
        if (img.complete && img.naturalWidth) {
          aspect = img.naturalWidth / img.naturalHeight;
        } else {
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          });
          if (img.naturalWidth) {
            aspect = img.naturalWidth / img.naturalHeight;
          }
        }
      } catch {}
    }

    const aspectVal = aspect && aspect > 0 ? aspect : 0.55;
    const fitW = Math.min(width, Math.round(height * aspectVal));
    const fitX = Math.round((width - fitW) / 2);
    const rect = `${fitX} 0 ${fitW} ${height}`;

    frameMediaEntries.push({
      index: i,
      filename,
      durationFrames,
      durationSeconds,
      rect,
    });

    if (i % 5 === 0) {
      const pct = Math.round(5 + (i / frames.length) * 40);
      onProgress?.({
        currentFrame: i + 1,
        totalFrames: frames.length,
        percentage: pct,
        message: `Empacotando imagem ${i + 1} de ${frames.length}...`,
        elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
      });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  const totalFramesDuration = frameMediaEntries.reduce((acc, f) => acc + f.durationSeconds, 0);

  // 2. Prepare anti-overlapping audio schedule
  onProgress?.({
    currentFrame: frames.length,
    totalFrames: frames.length,
    percentage: 50,
    message: 'Calculando alinhamento de áudio sem sobreposição para Shotcut...',
    elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
  });

  const audioTimeline = await prepareAudioTimeline(scenes, frames, totalFramesDuration);
  const audioMediaEntries: {
    index: number;
    filename: string;
    startFrame: number;
    durationFrames: number;
  }[] = [];

  for (let idx = 0; idx < audioTimeline.scheduledClips.length; idx++) {
    const clip = audioTimeline.scheduledClips[idx];
    const filename = `narracao_${String(idx + 1).padStart(3, '0')}.mp3`;

    let blob = clip.audioBlob;
    if (!blob && clip.audioUrl) {
      try {
        const r = await fetch(clip.audioUrl);
        blob = await r.blob();
      } catch {}
    }

    if (blob) {
      mediaFolder.file(filename, blob);
      audioMediaEntries.push({
        index: idx,
        filename,
        startFrame: Math.round(clip.startTime * fps),
        durationFrames: Math.round(clip.duration * fps),
      });
    }
  }

  const totalFramesCount = Math.round(
    Math.max(totalFramesDuration, audioTimeline.totalAudioDuration) * fps
  );

  // Extend the last video frame if total audio duration is longer than the raw frames sum
  // to ensure that video tracks match the total project duration without a black screen gap at the end
  const currentTotalVideoFrames = frameMediaEntries.reduce((acc, f) => acc + f.durationFrames, 0);
  if (totalFramesCount > currentTotalVideoFrames && frameMediaEntries.length > 0) {
    const extraFrames = totalFramesCount - currentTotalVideoFrames;
    const lastEntry = frameMediaEntries[frameMediaEntries.length - 1];
    lastEntry.durationFrames += extraFrames;
    lastEntry.durationSeconds = lastEntry.durationFrames / fps;
  }

  // 3. Build MLT XML String
  onProgress?.({
    currentFrame: frames.length,
    totalFrames: frames.length,
    percentage: 65,
    message: 'Gerando estrutura de faixas XML (.mlt)...',
    elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
  });

  const mltXml = `<?xml version="1.0" encoding="utf-8"?>
<mlt LC_NUMERIC="C" version="7.28.0" title="Manhwa Recap Project" producer="main_tractor">
  <profile description="HD ${width}x${height} ${fps} fps" width="${width}" height="${height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${aspectNum}" display_aspect_den="${aspectDen}" frame_rate_num="${fps}" frame_rate_den="1" colorspace="709"/>

  <!-- PRODUCERS: Faixa V1 (Fundo com desfoque e cobertura total 16:9) -->
${frameMediaEntries
  .map(
    (f) => `  <producer id="bg_prod_${f.index}" in="0" out="${f.durationFrames - 1}">
    <property name="length">${f.durationFrames}</property>
    <property name="eof">pause</property>
    <property name="resource">media/${f.filename}</property>
    <property name="mlt_service">qimage</property>
    <filter id="echo_${f.index}">
      <property name="mlt_service">pillar_echo</property>
      <property name="rect">${f.rect}</property>
      <property name="blur">6.0</property>
    </filter>
    <filter id="blur_${f.index}">
      <property name="mlt_service">boxblur</property>
      <property name="hori">12</property>
      <property name="vert">12</property>
    </filter>
    <filter id="dark_${f.index}">
      <property name="mlt_service">brightness</property>
      <property name="level">0.7</property>
    </filter>
  </producer>`
  )
  .join('\n')}

  <!-- PRODUCERS: Faixa V2 (Quadros principais com borda branca e zoom sutil) -->
${frameMediaEntries
  .map(
    (f) => `  <producer id="main_prod_${f.index}" in="0" out="${f.durationFrames - 1}">
    <property name="length">${f.durationFrames}</property>
    <property name="eof">pause</property>
    <property name="resource">media/${f.filename}</property>
    <property name="mlt_service">qimage</property>
    <filter id="border_${f.index}">
      <property name="mlt_service">avfilter.drawbox</property>
      <property name="av.x">0</property>
      <property name="av.y">0</property>
      <property name="av.w">iw</property>
      <property name="av.h">ih</property>
      <property name="av.color">white</property>
      <property name="av.t">7</property>
    </filter>
    <filter id="zoom_${f.index}">
      <property name="mlt_service">affine</property>
      <property name="transition.geometry">0=${Math.round(-width * 0.033)} ${Math.round(-height * 0.033)} ${Math.round(width * 1.066)} ${Math.round(height * 1.066)}:100%; ${f.durationFrames - 1}=${Math.round(-width * 0.05)} ${Math.round(-height * 0.05)} ${Math.round(width * 1.1)} ${Math.round(height * 1.1)}:100%</property>
    </filter>
  </producer>`
  )
  .join('\n')}

  <!-- PRODUCERS: Faixa A1 (Áudio de narração sem sobreposição) -->
${audioMediaEntries
  .map(
    (a) => `  <producer id="audio_prod_${a.index}" in="0" out="${a.durationFrames - 1}">
    <property name="length">${a.durationFrames}</property>
    <property name="eof">pause</property>
    <property name="resource">media/${a.filename}</property>
    <property name="mlt_service">avformat</property>
  </producer>`
  )
  .join('\n')}

  <!-- PLAYLISTS -->
  <playlist id="playlist_v1">
    <property name="shotcut:video">1</property>
    <property name="shotcut:name">V1 (Fundo Desfocado)</property>
${frameMediaEntries.map((f) => `    <entry producer="bg_prod_${f.index}" in="0" out="${f.durationFrames - 1}"/>`).join('\n')}
  </playlist>

  <playlist id="playlist_v2">
    <property name="shotcut:video">1</property>
    <property name="shotcut:name">V2 (Quadros Principais)</property>
${frameMediaEntries.map((f) => `    <entry producer="main_prod_${f.index}" in="0" out="${f.durationFrames - 1}"/>`).join('\n')}
  </playlist>

  <playlist id="playlist_a1">
    <property name="shotcut:audio">1</property>
    <property name="shotcut:name">A1 (Narração)</property>
${(() => {
  let entries: string[] = [];
  let currentHead = 0;
  audioMediaEntries.forEach((a) => {
    if (a.startFrame > currentHead) {
      const blankLength = a.startFrame - currentHead;
      entries.push(`    <blank length="${blankLength}"/>`);
      currentHead += blankLength;
    }
    entries.push(`    <entry producer="audio_prod_${a.index}" in="0" out="${a.durationFrames - 1}"/>`);
    currentHead += a.durationFrames;
  });
  return entries.join('\n');
})()}
  </playlist>

  <!-- TRACTOR MULTI-TRACK -->
  <tractor id="main_tractor" in="0" out="${Math.max(1, totalFramesCount - 1)}">
    <property name="shotcut">1</property>
    <property name="shotcut:scaleFactor">1</property>
    <property name="shotcut:projectAudioChannels">2</property>
    <track producer="playlist_v1"/>
    <track producer="playlist_v2"/>
    <track producer="playlist_a1"/>
    <transition id="composite_v1_v2">
      <property name="a_track">0</property>
      <property name="b_track">1</property>
      <property name="mlt_service">composite</property>
      <property name="geometry">0 0 ${width} ${height}:100%</property>
    </transition>
  </tractor>
</mlt>
`;

  zip.file('projeto.mlt', mltXml);

  // Informative README
  const readme = `PROJETO SHOTCUT (.mlt) - RECAP DE MANHWA
==========================================
Data de Exportação: ${new Date().toLocaleString('pt-BR')}
Resolução: ${width}x${height} (${resolution})
Taxa de Quadros: ${fps} FPS
Total de Quadros: ${frames.length}
Total de Cenas de Áudio: ${audioMediaEntries.length}

COMO ABRIR NO SHOTCUT:
------------------------------------------
1. Extraia TODO o conteúdo deste arquivo ZIP para uma pasta em seu computador.
2. Certifique-se de que a pasta "media/" e o arquivo "projeto.mlt" fiquem juntos na mesma pasta.
3. Abra o Shotcut (versão 22 ou superior recomendada).
4. Clique em "Abrir Arquivo" e selecione "projeto.mlt".
5. O projeto abrirá com toda a montagem pronta na timeline:
   - Faixa V1: Fundo com efeito de desfoque cinematográfico
   - Faixa V2: Quadros centrados com as durações exatas definidas
   - Faixa A1: Áudio de narração sincronizado e sequencial (sem sobreposição)
`;
  zip.file('LEIA-ME.txt', readme);

  onProgress?.({
    currentFrame: frames.length,
    totalFrames: frames.length,
    percentage: 75,
    message: 'Compactando arquivo ZIP final...',
    elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
  });

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (meta) => {
      onProgress?.({
        currentFrame: frames.length,
        totalFrames: frames.length,
        percentage: Math.round(75 + meta.percent * 0.24),
        message: `Compactando arquivo ZIP (${meta.percent.toFixed(0)}%)...`,
        elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
      });
    }
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `Projeto_Shotcut_Recap_${dateStr}.zip`;

  return {
    blob: zipBlob,
    filename,
    mimeType: 'application/zip',
    format: 'shotcut',
    duration: totalFramesCount / fps,
  };
}

/**
 * Universal Unified Exporter Dispatcher
 */
export async function exportRecap({
  format = 'mp4',
  frames,
  scenes,
  chapters = [],
  resolution = '16:9',
  fps = 30,
  includeAudio = true,
  includeSubtitles = true,
  bitrate = 6_000_000,
  signal,
  onProgress,
}: ExportOptions & {
  frames: FrameItem[];
  scenes: SceneItem[];
  chapters?: ChapterItem[];
}): Promise<ExportResult> {
  if (format === 'shotcut') {
    return generateShotcutMLT({
      frames,
      scenes,
      chapters,
      resolution,
      fps,
      signal,
      onProgress,
    });
  }

  if (format === 'webm') {
    return renderWebM({
      frames,
      scenes,
      resolution,
      fps,
      includeAudio,
      includeSubtitles,
      bitrate,
      signal,
      onProgress,
    });
  }

  // Default: MP4 with Dedicated Web Worker (high-performance, downscaled blur cache & OffscreenCanvas)
  try {
    return await exportRecapWithWorker(frames, scenes, {
      resolution,
      fps,
      includeAudio,
      includeSubtitles,
      bitrate,
      signal,
      onProgress,
    });
  } catch (err: any) {
    if (err.message && (err.message.includes('WebCodecs') || err.message.includes('VideoEncoder'))) {
      console.warn('Worker WebCodecs indisponível, acionando fallback WebM:', err);
      return await renderWebM({
        frames,
        scenes,
        resolution,
        fps,
        includeAudio,
        includeSubtitles,
        bitrate,
        signal,
        onProgress,
      });
    }
    throw err;
  }
}
