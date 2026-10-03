import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { FrameItem, SceneItem } from '../types';
import { exportRecap, ExportResolution, renderMP4WithWebCodecs, renderWebM, generateShotcutMLT } from './videoExporter';

export { exportRecap, renderMP4WithWebCodecs, renderWebM, generateShotcutMLT };

export type VideoFormat = 'mp4' | 'webm' | 'mkv' | 'mov';
export type VideoResolutionPreset = '1080p' | '720p' | '4k' | 'vertical_9_16' | 'square_1_1';

export interface ResolutionConfig {
  width: number;
  height: number;
  label: string;
  aspect: string;
  hint: string;
}

export const RESOLUTION_PRESETS: Record<VideoResolutionPreset, ResolutionConfig> = {
  '1080p': {
    width: 1920,
    height: 1080,
    label: '1080p Full HD',
    aspect: '16:9',
    hint: 'Padrão YouTube, TVs e Monitores',
  },
  '720p': {
    width: 1280,
    height: 720,
    label: '720p HD',
    aspect: '16:9',
    hint: 'Renderização rápida e arquivo leve',
  },
  'vertical_9_16': {
    width: 1080,
    height: 1920,
    label: 'Vertical 9:16',
    aspect: '9:16',
    hint: 'YouTube Shorts, TikTok e Instagram Reels',
  },
  'square_1_1': {
    width: 1080,
    height: 1080,
    label: 'Quadrado 1:1',
    aspect: '1:1',
    hint: 'Feed do Instagram e Posts',
  },
  '4k': {
    width: 3840,
    height: 2160,
    label: '4K Ultra HD',
    aspect: '16:9',
    hint: 'Máxima definição para monitores 4K',
  },
};

export interface VideoFormatConfig {
  id: VideoFormat;
  name: string;
  extension: string;
  mimeType: string;
  badge: string;
  description: string;
}

export const VIDEO_FORMATS: VideoFormatConfig[] = [
  {
    id: 'mp4',
    name: 'MP4 (H.264 / AVC)',
    extension: '.mp4',
    mimeType: 'video/mp4',
    badge: 'Recomendado',
    description: 'Compatível com tudo: YouTube, CapCut, Premiere, Celulares e TVs.',
  },
  {
    id: 'webm',
    name: 'WebM (VP9 / VP8)',
    extension: '.webm',
    mimeType: 'video/webm',
    badge: 'Mais Rápido',
    description: 'Renderização nativa no navegador, alta compressão e leveza.',
  },
  {
    id: 'mkv',
    name: 'MKV (Matroska)',
    extension: '.mkv',
    mimeType: 'video/x-matroska',
    badge: 'Alta Fidelidade',
    description: 'Excelente para arquivamento e edição em VLC / DaVinci.',
  },
  {
    id: 'mov',
    name: 'MOV (QuickTime)',
    extension: '.mov',
    mimeType: 'video/quicktime',
    badge: 'Apple / Pro',
    description: 'Padrão para ecossistemas Apple e Final Cut Pro.',
  },
];

export type FramingMode = 'blurred_pillarbox' | 'cover' | 'contain_black';

export interface FramingModeConfig {
  id: FramingMode;
  name: string;
  badge: string;
  description: string;
}

export const FRAMING_MODES: FramingModeConfig[] = [
  {
    id: 'blurred_pillarbox',
    name: 'Fit com Fundo Desfocado Dinâmico (Pillarbox)',
    badge: 'Recomendado para Manhwa',
    description: 'Enquadra o corte vertical 100% visível e centralizado com fundo desfocado dinâmico (sem cortar a arte).',
  },
  {
    id: 'cover',
    name: 'Cover (Preencher Tela Cheia)',
    badge: 'Zoom com Cortes',
    description: 'Estica a imagem para preencher toda a tela, cortando partes superiores ou laterais do manhwa.',
  },
  {
    id: 'contain_black',
    name: 'Contain (Barras Pretas Sólidas)',
    badge: 'Clássico',
    description: 'Enquadra a imagem inteira com barras pretas sólidas nas laterais.',
  },
];

/**
 * Retorna o filtro FFmpeg e o script Python/MoviePy equivalentes para composição
 * de vídeo com Fundo Desfocado Dinâmico (Blurred Background Pillarbox)
 */
export function getFfmpegPillarboxFilter(
  width = 1920,
  height = 1080,
  framingMode: FramingMode = 'blurred_pillarbox'
) {
  const fgMaxH = Math.round(height * 0.96);

  if (framingMode === 'cover') {
    const filterComplex = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const fullCliCommand = `ffmpeg -loop 1 -i quadro.jpg -vf "${filterComplex}" -t 5 -c:v libx264 -pix_fmt yuv420p output.mp4`;
    const moviePySnippet = `# Python MoviePy - Cover Mode
from moviepy.editor import ImageClip
video = ImageClip("quadro.jpg").resize(height=${height}).crop(x_center=None, y_center=None, width=${width}, height=${height}).set_duration(5)
video.write_videofile("recap.mp4", fps=30, codec="libx264")`;
    return { filterComplex, fullCliCommand, moviePySnippet };
  }

  // Padrão: Blurred Background Pillarbox
  const filterComplex = `[0:v]split=2[bg_raw][fg_raw]; [bg_raw]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=32:5,eq=brightness=-0.12[bg_blur]; [fg_raw]scale=-1:'min(${fgMaxH},ih)':flags=lanczos[fg_fit]; [bg_blur][fg_fit]overlay=(W-w)/2:(H-h)/2`;

  const fullCliCommand = `ffmpeg -loop 1 -i quadro.jpg -filter_complex "${filterComplex}" -t 5 -c:v libx264 -pix_fmt yuv420p output.mp4`;

  const moviePySnippet = `# Python MoviePy - Blurred Background Pillarbox
from moviepy.editor import ImageClip, CompositeVideoClip
import cv2

# 1. Camada de Fundo: preenche 100% da tela + desfoque Gaussiano + escurecimento
bg = (ImageClip("quadro.jpg")
      .resize(height=${height})
      .crop(x_center=None, y_center=None, width=${width}, height=${height})
      .fl_image(lambda img: cv2.GaussianBlur(img, (51, 51), 0))
      .colorx(0.72)) # 28% de escurecimento

# 2. Camada Principal: proporção real (fit contain) com 96% de altura máxima
fg = (ImageClip("quadro.jpg")
      .resize(height=${fgMaxH})
      .set_position("center"))

# 3. Composição final
video = CompositeVideoClip([bg, fg], size=(${width}, ${height})).set_duration(5)
video.write_videofile("recap.mp4", fps=30, codec="libx264")`;

  return { filterComplex, fullCliCommand, moviePySnippet };
}

export interface RenderVideoOptions {
  format?: VideoFormat;
  resolution?: VideoResolutionPreset;
  width?: number;
  height?: number;
  fps?: number;
  transition?: string;
  bitrate?: number;
  includeAudio?: boolean;
  includeSubtitles?: boolean;
  framingMode?: FramingMode;
  onProgress?: (progressPercent: number, statusText?: string) => void;
  signal?: AbortSignal;
}

export interface RenderVideoResult {
  blob: Blob;
  format: VideoFormat;
  filename: string;
  mimeType: string;
  duration: number;
}

/**
 * Preloads an image into an HTMLImageElement with cross-origin handling
 */
function preloadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

/**
 * Wraps text into lines that fit within maxWidth on a 2D canvas context
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const testLine = currentLine ? `${currentLine} ${words[i]}` : words[i];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Checks supported MIME types for MediaRecorder
 */
function getSupportedMediaRecorderMimeType(format: VideoFormat): string {
  if (typeof MediaRecorder === 'undefined') return '';

  if (format === 'mp4') {
    const mp4Mimes = [
      'video/mp4;codecs=avc1.42001E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4;codecs=h264',
      'video/mp4',
    ];
    for (const m of mp4Mimes) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
  } else if (format === 'mov') {
    const movMimes = [
      'video/quicktime',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    for (const m of movMimes) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
  } else if (format === 'mkv') {
    const mkvMimes = [
      'video/x-matroska;codecs=avc1,opus',
      'video/x-matroska;codecs=avc1',
      'video/x-matroska',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    for (const m of mkvMimes) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
  }

  // WebM or fallback
  const webmMimes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of webmMimes) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }

  return '';
}

/**
 * Main function to render recap frames, transitions, subtitles and audio into a video blob
 */
export async function renderRecapVideo(
  frames: FrameItem[],
  scenes: SceneItem[],
  options: RenderVideoOptions = {}
): Promise<Blob> {
  const result = await renderRecapVideoDetailed(frames, scenes, options);
  return result.blob;
}

/**
 * Detailed renderer returning blob along with filename, format and metadata
 */
export async function renderRecapVideoDetailed(
  frames: FrameItem[],
  scenes: SceneItem[],
  options: RenderVideoOptions = {}
): Promise<RenderVideoResult> {
  if (frames.length === 0) {
    throw new Error('Nenhum quadro fornecido para renderização de vídeo.');
  }

  const format = options.format === 'webm' ? 'webm' : 'mp4';
  const resolution: ExportResolution = options.resolution === 'vertical_9_16' ? '9:16' : '16:9';

  const res = await exportRecap({
    format,
    frames,
    scenes,
    resolution,
    fps: options.fps || 30,
    includeAudio: options.includeAudio !== false,
    includeSubtitles: options.includeSubtitles !== false,
    bitrate: options.bitrate || 6_000_000,
    signal: options.signal,
    onProgress: (p) => {
      options.onProgress?.(p.percentage, p.message);
    },
  });

  return {
    blob: res.blob,
    format: options.format || 'mp4',
    filename: res.filename,
    mimeType: res.mimeType,
    duration: res.duration,
  };
}

async function _legacyRenderDetailed(
  frames: FrameItem[],
  scenes: SceneItem[],
  options: RenderVideoOptions = {}
): Promise<RenderVideoResult> {
  const format: VideoFormat = options.format || 'mp4';
  const presetConfig = options.resolution ? RESOLUTION_PRESETS[options.resolution] : null;

  // Make sure width and height are even numbers (H.264 requirement)
  const rawWidth = options.width || (presetConfig ? presetConfig.width : 1920);
  const rawHeight = options.height || (presetConfig ? presetConfig.height : 1080);
  const width = Math.floor(rawWidth / 2) * 2;
  const height = Math.floor(rawHeight / 2) * 2;

  const fps = options.fps || 30;
  const transition = options.transition || 'Zoom dinâmico';
  const bitrate = options.bitrate || 6_000_000;
  const includeAudio = options.includeAudio !== false;
  const includeSubtitles = options.includeSubtitles !== false;
  const framingMode: FramingMode = options.framingMode || 'blurred_pillarbox';

  const updateProgress = (pct: number, msg: string) => {
    if (options.onProgress) {
      options.onProgress(Math.min(100, Math.max(0, Math.round(pct))), msg);
    }
  };

  updateProgress(5, 'Carregando imagens dos quadros...');

  // 1. Preload frame images
  const loadedImages: HTMLImageElement[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (options.signal?.aborted) {
      throw new Error('Renderização cancelada.');
    }
    try {
      const img = await preloadImage(frames[i].src);
      loadedImages.push(img);
    } catch {
      // Fallback canvas
      const fallbackCanvas = document.createElement('canvas');
      fallbackCanvas.width = width;
      fallbackCanvas.height = height;
      const fctx = fallbackCanvas.getContext('2d')!;
      fctx.fillStyle = '#0f172a';
      fctx.fillRect(0, 0, width, height);
      fctx.fillStyle = '#38bdf8';
      fctx.font = 'bold 36px sans-serif';
      fctx.textAlign = 'center';
      fctx.fillText(frames[i].label || `Quadro ${i + 1}`, width / 2, height / 2);
      const fallbackImg = new Image();
      fallbackImg.src = fallbackCanvas.toDataURL();
      loadedImages.push(fallbackImg);
    }
    updateProgress(5 + ((i + 1) / frames.length) * 15, `Carregando imagem ${i + 1} de ${frames.length}...`);
  }

  // Calculate durations
  const durations = frames.map((f) => Math.max(1, f.duration || 4));
  const totalSeconds = durations.reduce((a, b) => a + b, 0);
  const totalFramesCount = Math.round(totalSeconds * fps);

  // 2. Prepare narration audio clips and bake master soundtrack offline
  let audioContext: AudioContext | null = null;
  let audioDestinationNode: MediaStreamAudioDestinationNode | null = null;
  let masterAudioBuffer: AudioBuffer | null = null;

  const audioClips: {
    sceneId: string;
    startTime: number;
    duration: number;
    audioUrl: string;
  }[] = [];

  if (includeAudio) {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.audioUrl) continue;

      // Find start time of this scene on the timeline based on its frames
      let startTime = 0;
      let accTime = 0;
      let found = false;

      for (let f = 0; f < frames.length; f++) {
        const frame = frames[f];
        const matchChapter = scene.chapterId && frame.chapterId && scene.chapterId === frame.chapterId;
        const matchPage = scene.pageNumber && frame.pageNumber && scene.pageNumber === frame.pageNumber;
        const matchFrames = scene.frames?.some((sf) => sf.id === frame.id);

        if ((matchChapter && matchPage) || matchFrames) {
          startTime = accTime;
          found = true;
          break;
        }
        accTime += frame.duration || 4;
      }

      if (!found) {
        startTime = (i / Math.max(1, scenes.length)) * totalSeconds;
      }

      audioClips.push({
        sceneId: scene.id,
        startTime,
        duration: scene.audioDuration || 4,
        audioUrl: scene.audioUrl,
      });
    }
  }

  if (audioClips.length > 0 && typeof window !== 'undefined') {
    try {
      updateProgress(20, 'Decodificando trilhas de áudio da narração IA...');
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContext = new AudioCtxClass();

      // Ensure audio context is running
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch {}
      }

      const decodedClips: { startTime: number; buffer: AudioBuffer }[] = [];

      for (const clip of audioClips) {
        try {
          const resp = await fetch(clip.audioUrl);
          const arrayBuf = await resp.arrayBuffer();
          const decoded = await audioContext.decodeAudioData(arrayBuf);
          decodedClips.push({ startTime: clip.startTime, buffer: decoded });
        } catch (err) {
          console.warn('Não foi possível decodificar áudio da cena:', clip.sceneId, err);
        }
      }

      // Mix all decoded clips into a continuous offline master soundtrack
      if (decodedClips.length > 0) {
        const sampleRate = audioContext.sampleRate || 44100;
        const totalSampleFrames = Math.ceil((totalSeconds + 1) * sampleRate);
        const offlineCtx = new OfflineAudioContext(2, totalSampleFrames, sampleRate);

        decodedClips.forEach((dc) => {
          const src = offlineCtx.createBufferSource();
          src.buffer = dc.buffer;
          src.connect(offlineCtx.destination);
          src.start(Math.max(0, dc.startTime));
        });

        masterAudioBuffer = await offlineCtx.startRendering();
      }
    } catch (e) {
      console.warn('Erro ao processar áudio da narração:', e);
    }
  }

  // 3. Prepare Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Check if we can use WebCodecs (mp4-muxer) when no audio or when preferred
  const isWebCodecsSupported =
    typeof window !== 'undefined' &&
    'VideoEncoder' in window &&
    'VideoFrame' in window;

  const supportedMime = getSupportedMediaRecorderMimeType(format);

  // If format is MP4 and there is NO audio track, WebCodecs is ultra-fast and doesn't require real-time playback
  const useWebCodecsWithoutAudio = (format === 'mp4' || format === 'mov') && isWebCodecsSupported && !masterAudioBuffer;

  if (useWebCodecsWithoutAudio) {
    updateProgress(25, 'Iniciando multiplexador MP4 ultra-rápido (WebCodecs)...');

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict',
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error('Erro no VideoEncoder:', e),
    });

    videoEncoder.configure({
      codec: 'avc1.42001f', // AVC Baseline Profile
      width,
      height,
      bitrate,
      framerate: fps,
    });

    let currentFrameIndex = 0;
    let accumulatedTime = 0;

    for (let f = 0; f < totalFramesCount; f++) {
      if (options.signal?.aborted) {
        videoEncoder.close();
        throw new Error('Renderização cancelada.');
      }

      const currentTime = f / fps;

      while (
        currentFrameIndex < frames.length - 1 &&
        currentTime > accumulatedTime + durations[currentFrameIndex]
      ) {
        accumulatedTime += durations[currentFrameIndex];
        currentFrameIndex++;
      }

      const img = loadedImages[currentFrameIndex];
      const frameElapsed = currentTime - accumulatedTime;
      const frameDuration = durations[currentFrameIndex];

      // Draw canvas frame
      drawRecapCanvasFrame({
        ctx,
        width,
        height,
        img,
        frameLabel: frames[currentFrameIndex]?.label,
        currentTime,
        totalSeconds,
        frameElapsed,
        frameDuration,
        transition,
        scenes,
        includeSubtitles,
        framingMode,
      });

      // Encode frame
      const timestampMicros = Math.round(currentTime * 1_000_000);
      const videoFrame = new VideoFrame(canvas, {
        timestamp: timestampMicros,
        duration: Math.round((1 / fps) * 1_000_000),
      });

      const isKeyFrame = f % (fps * 2) === 0;
      videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
      videoFrame.close();

      if (f % 15 === 0) {
        const pct = 25 + (f / totalFramesCount) * 70;
        updateProgress(pct, `Codificando MP4: quadro ${f + 1} de ${totalFramesCount}...`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    updateProgress(96, 'Finalizando arquivo MP4...');
    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    const finalBlob = new Blob([muxer.target.buffer], {
      type: format === 'mov' ? 'video/quicktime' : 'video/mp4',
    });

    updateProgress(100, 'Vídeo MP4 gerado com sucesso!');

    const dateStr = new Date().toISOString().slice(0, 10);
    const ext = format === 'mov' ? '.mov' : '.mp4';
    const filename = `Recap_${width}x${height}_${dateStr}${ext}`;

    return {
      blob: finalBlob,
      format,
      filename,
      mimeType: finalBlob.type,
      duration: totalSeconds,
    };
  }

  // UNIVERSAL PIPELINE: MediaRecorder with audio track and anti-freeze failsafe
  updateProgress(25, 'Iniciando captura de vídeo e áudio em tempo real...');

  const canvasStream = canvas.captureStream(fps);

  // If master audio buffer is present, play it into an audio destination node
  if (audioContext && masterAudioBuffer) {
    try {
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      audioDestinationNode = audioContext.createMediaStreamDestination();
      const masterSource = audioContext.createBufferSource();
      masterSource.buffer = masterAudioBuffer;
      masterSource.connect(audioDestinationNode);

      const audioTracks = audioDestinationNode.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        canvasStream.addTrack(audioTracks[0]);
      }
      masterSource.start(0);
    } catch (audioErr) {
      console.warn('Erro ao conectar áudio à stream de gravação:', audioErr);
    }
  }

  const mimeType = supportedMime || 'video/webm';
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  recorder.start(100);

  let currentFrameIndex = 0;
  let accumulatedTime = 0;

  for (let f = 0; f < totalFramesCount; f++) {
    if (options.signal?.aborted) {
      recorder.stop();
      if (audioContext) audioContext.close();
      canvasStream.getTracks().forEach((t) => t.stop());
      throw new Error('Renderização cancelada.');
    }

    const currentTime = f / fps;

    while (
      currentFrameIndex < frames.length - 1 &&
      currentTime > accumulatedTime + durations[currentFrameIndex]
    ) {
      accumulatedTime += durations[currentFrameIndex];
      currentFrameIndex++;
    }

    const img = loadedImages[currentFrameIndex];
    const frameElapsed = currentTime - accumulatedTime;
    const frameDuration = durations[currentFrameIndex];

    drawRecapCanvasFrame({
      ctx,
      width,
      height,
      img,
      frameLabel: frames[currentFrameIndex]?.label,
      currentTime,
      totalSeconds,
      frameElapsed,
      frameDuration,
      transition,
      scenes,
      includeSubtitles,
      framingMode,
    });

    if (f % 15 === 0) {
      const pct = 25 + (f / totalFramesCount) * 70;
      const audioStatus = masterAudioBuffer ? 'com áudio IA' : 'vídeo';
      updateProgress(pct, `Renderizando ${audioStatus}: quadro ${f + 1} de ${totalFramesCount}...`);
    }

    // Yield control so MediaRecorder captures the frame cleanly
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  updateProgress(97, 'Empacotando arquivo final de vídeo...');

  // Wait a moment for any last frame and audio buffer to settle
  await new Promise((r) => setTimeout(r, 150));

  const finalBlob = await new Promise<Blob>((resolve) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      // Stop all media tracks to prevent browser recorder from hanging
      try {
        canvasStream.getTracks().forEach((t) => t.stop());
      } catch {}

      if (audioDestinationNode) {
        try {
          audioDestinationNode.stream.getTracks().forEach((t) => t.stop());
        } catch {}
      }

      let finalMime = mimeType;
      if (format === 'mp4' && !mimeType.includes('mp4')) {
        finalMime = 'video/mp4';
      } else if (format === 'mkv') {
        finalMime = 'video/x-matroska';
      } else if (format === 'mov') {
        finalMime = 'video/quicktime';
      }

      const blob = new Blob(chunks, { type: finalMime });
      resolve(blob);
    };

    recorder.onstop = finish;

    // Failsafe timeout: if browser onstop doesn't fire within 2000ms, force finish
    setTimeout(finish, 2000);

    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch {
      finish();
    }
  });

  if (audioContext) {
    try {
      await audioContext.close();
    } catch {}
  }

  updateProgress(100, 'Vídeo renderizado com sucesso!');

  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = format === 'mp4' ? '.mp4' : format === 'mkv' ? '.mkv' : format === 'mov' ? '.mov' : '.webm';
  const filename = `Recap_${width}x${height}_${dateStr}${ext}`;

  return {
    blob: finalBlob,
    format,
    filename,
    mimeType: finalBlob.type,
    duration: totalSeconds,
  };
}

interface DrawFrameOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  img?: HTMLImageElement;
  frameLabel?: string;
  currentTime: number;
  totalSeconds: number;
  frameElapsed: number;
  frameDuration: number;
  transition: string;
  scenes: SceneItem[];
  includeSubtitles: boolean;
  framingMode?: FramingMode;
}

/**
 * Draws a single frame onto the canvas with Blurred Background Pillarbox framing,
 * gentle Ken Burns/pan transitions on the foreground, and styled recap subtitles.
 */
function drawRecapCanvasFrame(opt: DrawFrameOptions) {
  const {
    ctx,
    width,
    height,
    img,
    currentTime,
    totalSeconds,
    frameElapsed,
    frameDuration,
    transition,
    scenes,
    includeSubtitles,
    framingMode = 'blurred_pillarbox',
  } = opt;

  const progressInFrame = Math.max(0, Math.min(1, frameElapsed / frameDuration));

  // 1. Clear background
  ctx.fillStyle = '#06080e';
  ctx.fillRect(0, 0, width, height);

  if (img && img.naturalWidth && img.naturalHeight) {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = width / height;

    if (framingMode === 'blurred_pillarbox') {
      // =========================================================================
      // 1. CAMADA DE FUNDO (BACKGROUND LAYER): Fundo Desfocado Dinâmico (Pillarbox)
      // =========================================================================
      ctx.save();
      // Desfoque Gaussiano pesado (26px a 40px proporcional à escala do vídeo)
      const blurPx = Math.max(26, Math.min(42, Math.round(Math.min(width, height) * 0.034)));
      try {
        ctx.filter = `blur(${blurPx}px)`;
      } catch {
        // Fallback gracioso caso filter não seja suportado no ambiente
      }

      // Escalonar fundo para preencher 100% da área do vídeo (cover) + 14% de respiro para o blur não criar bordas translúcidas
      let bgW = width * 1.14;
      let bgH = height * 1.14;
      if (imgRatio > canvasRatio) {
        bgH = height * 1.14;
        bgW = bgH * imgRatio;
      } else {
        bgW = width * 1.14;
        bgH = bgW / imgRatio;
      }
      const bgX = (width - bgW) / 2;
      const bgY = (height - bgH) / 2;

      ctx.drawImage(img, bgX, bgY, bgW, bgH);
      ctx.restore();

      // Leve escurecimento / overlay preto de contraste (20% a 30% de opacidade)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      ctx.fillRect(0, 0, width, height);

      // =========================================================================
      // 2. CAMADA PRINCIPAL (FOREGROUND LAYER): Proporção Real, Fit 96% & Sombra
      // =========================================================================
      ctx.save();

      // Animações (Ken Burns / Pan / Zoom) contidas na camada principal
      let scale = 1.0;
      let transX = 0;
      let transY = 0;

      if (transition.includes('Zoom') || transition.includes('Ken')) {
        scale = 1.0 + progressInFrame * 0.04;
        transX = (progressInFrame - 0.5) * (width * 0.015);
        transY = (progressInFrame - 0.5) * (height * 0.01);
      } else if (transition.includes('Pan') || transition.includes('vertical')) {
        scale = 1.02;
        transY = (progressInFrame - 0.5) * (height * 0.035);
      }

      ctx.translate(width / 2 + transX, height / 2 + transY);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);

      // Sombra suave (drop shadow) destacando o recorte nítido do fundo embaçado
      ctx.shadowColor = 'rgba(0, 0, 0, 0.78)';
      ctx.shadowBlur = Math.max(16, Math.round(Math.min(width, height) * 0.026));
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.max(4, Math.round(Math.min(width, height) * 0.01));

      // Altura máxima de 96% (respiro de 4%), largura automática respeitando a proporção nativa
      const maxFgHeight = height * 0.96;
      const maxFgWidth = width * 0.96;
      let fgW = maxFgHeight * imgRatio;
      let fgH = maxFgHeight;

      if (fgW > maxFgWidth) {
        fgW = maxFgWidth;
        fgH = maxFgWidth / imgRatio;
      }

      const fgX = (width - fgW) / 2;
      const fgY = (height - fgH) / 2;

      ctx.drawImage(img, fgX, fgY, fgW, fgH);
      ctx.restore();
    } else if (framingMode === 'cover') {
      // Modo Cover tradicional (tela cheia com corte)
      ctx.save();
      let scale = 1.0;
      let transX = 0;
      let transY = 0;

      if (transition.includes('Zoom') || transition.includes('Ken')) {
        scale = 1.0 + progressInFrame * 0.12;
        transX = (progressInFrame - 0.5) * (width * 0.02);
        transY = (progressInFrame - 0.5) * (height * 0.015);
      } else if (transition.includes('Pan') || transition.includes('vertical')) {
        scale = 1.06;
        transY = (progressInFrame - 0.5) * (height * 0.06);
      }

      ctx.translate(width / 2 + transX, height / 2 + transY);
      ctx.scale(scale, scale);
      ctx.translate(-width / 2, -height / 2);

      let drawW = width;
      let drawH = height;
      if (imgRatio > canvasRatio) {
        drawH = height;
        drawW = height * imgRatio;
      } else {
        drawW = width;
        drawH = width / imgRatio;
      }
      const drawX = (width - drawW) / 2;
      const drawY = (height - drawH) / 2;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();
    } else {
      // Modo Contain sobre barras pretas
      ctx.save();
      const maxFgHeight = height * 0.96;
      const maxFgWidth = width * 0.96;
      let fgW = maxFgHeight * imgRatio;
      let fgH = maxFgHeight;
      if (fgW > maxFgWidth) {
        fgW = maxFgWidth;
        fgH = maxFgWidth / imgRatio;
      }
      const fgX = (width - fgW) / 2;
      const fgY = (height - fgH) / 2;
      ctx.drawImage(img, fgX, fgY, fgW, fgH);
      ctx.restore();
    }
  }

  // 4. Subtle Vignette / Edge Shadow for cinematic recap look
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  // 5. Transition Effects (Flash / Fade at boundaries)
  const timeUntilNext = frameDuration - frameElapsed;
  if (transition.includes('Flash') && (frameElapsed < 0.15 || timeUntilNext < 0.15)) {
    const alpha = Math.max(0, 1 - Math.min(frameElapsed, timeUntilNext) / 0.15);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
    ctx.fillRect(0, 0, width, height);
  } else if (transition.includes('Fade') && timeUntilNext < 0.35) {
    const alpha = (0.35 - timeUntilNext) / 0.35;
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.85})`;
    ctx.fillRect(0, 0, width, height);
  }

  // 6. Styled Recap Subtitle Overlay (if enabled)
  if (includeSubtitles && scenes.length > 0) {
    const activeSceneIndex = Math.min(
      scenes.length - 1,
      Math.floor((currentTime / totalSeconds) * scenes.length)
    );
    const activeScene = scenes[activeSceneIndex];

    if (activeScene && activeScene.text) {
      const fontSize = Math.max(18, Math.min(32, Math.round(height * 0.032)));
      ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;

      const maxTextWidth = width * 0.82;
      const lines = wrapCanvasText(ctx, activeScene.text, maxTextWidth);

      if (lines.length > 0) {
        const lineHeight = fontSize * 1.35;
        const boxPaddingH = fontSize * 1.2;
        const boxPaddingV = fontSize * 0.75;
        const totalTextHeight = lines.length * lineHeight;
        const boxHeight = totalTextHeight + boxPaddingV * 2;
        const boxBottomMargin = Math.max(30, Math.round(height * 0.065));
        const boxY = height - boxBottomMargin - boxHeight;

        // Measure widest line for snug box width
        let maxLineWidth = 0;
        lines.forEach((l) => {
          const w = ctx.measureText(l).width;
          if (w > maxLineWidth) maxLineWidth = w;
        });

        const boxWidth = Math.min(maxTextWidth + boxPaddingH * 2, maxLineWidth + boxPaddingH * 2);
        const boxX = (width - boxWidth) / 2;

        // Subtitle Background Box with Rounded Corners
        ctx.save();
        ctx.fillStyle = 'rgba(10, 15, 26, 0.82)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1.5;

        const radius = Math.min(14, boxHeight / 4);
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
        ctx.fill();
        ctx.stroke();

        // Draw Subtitle Text Lines
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1;

        lines.forEach((line, idx) => {
          const lineY = boxY + boxPaddingV + idx * lineHeight;
          ctx.fillText(line, width / 2, lineY);
        });

        ctx.restore();
      }
    }
  }

  // 7. Discreet Timecode Badge in Top Right
  const badgeFontSize = Math.max(11, Math.round(height * 0.016));
  ctx.font = `600 ${badgeFontSize}px monospace`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const mins = Math.floor(currentTime / 60);
  const secs = Math.floor(currentTime % 60);
  const totalMins = Math.floor(totalSeconds / 60);
  const totalSecs = Math.floor(totalSeconds % 60);
  ctx.fillText(
    `${mins}:${String(secs).padStart(2, '0')} / ${totalMins}:${String(totalSecs).padStart(2, '0')}`,
    width - Math.round(width * 0.02),
    Math.round(height * 0.02)
  );
}
