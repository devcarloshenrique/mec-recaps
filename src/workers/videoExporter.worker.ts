import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface WorkerFrameEntry {
  index: number;
  durationFrames: number;
  durationSeconds: number;
  imageBlob: Blob;
  subtitleText?: string;
  transition?: string;
}

export interface WorkerAudioPayload {
  sampleRate: number;
  channels: number;
  leftChannel: Float32Array;
  rightChannel: Float32Array;
}

export interface WorkerStartPayload {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  frames: WorkerFrameEntry[];
  audio: WorkerAudioPayload | null;
  includeSubtitles?: boolean;
}

let isCancelled = false;

self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (!data) return;

  if (data.type === 'CANCEL') {
    isCancelled = true;
    return;
  }

  if (data.type === 'START') {
    isCancelled = false;
    try {
      await runExportPipeline(data.payload as WorkerStartPayload);
    } catch (err: any) {
      self.postMessage({
        type: 'ERROR',
        payload: {
          message: err?.message || 'Erro inesperado na renderização do vídeo.',
          details: String(err?.stack || err),
        },
      });
    }
  }
};

async function runExportPipeline(payload: WorkerStartPayload) {
  const { width, height, fps, bitrate, frames, audio, includeSubtitles = true } = payload;

  if (!frames || frames.length === 0) {
    throw new Error('Nenhum quadro fornecido para renderização.');
  }

  // Calculate total frame count
  const totalFrames = frames.reduce((acc, f) => acc + f.durationFrames, 0);
  if (totalFrames <= 0) {
    throw new Error('Duração total dos quadros inválida.');
  }

  // Check WebCodecs support in Worker
  if (typeof (self as any).VideoEncoder === 'undefined') {
    throw new Error('WebCodecs (VideoEncoder) não é suportado neste ambiente.');
  }

  // 1. Initialize mp4-muxer
  const hasAudioTrack = Boolean(audio && audio.leftChannel && audio.leftChannel.length > 0);
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
          sampleRate: audio!.sampleRate || 44100,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  });

  // 2. Select VideoEncoder H.264 profile
  const videoEncoderConfigs = [
    { codec: 'avc1.42E01E', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' as const },
    { codec: 'avc1.4d002a', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' as const },
    { codec: 'avc1.42001f', width, height, bitrate, framerate: fps, hardwareAcceleration: 'prefer-hardware' as const },
  ];

  let selectedCodecConfig = videoEncoderConfigs[0];
  for (const cfg of videoEncoderConfigs) {
    try {
      const support = await (self as any).VideoEncoder.isConfigSupported(cfg);
      if (support && support.supported) {
        selectedCodecConfig = cfg;
        break;
      }
    } catch {}
  }

  let encoderError: Error | null = null;
  const videoEncoder = new (self as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: any) => {
      console.error('[Worker] Erro no VideoEncoder:', e);
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  videoEncoder.configure(selectedCodecConfig);

  // 3. Configure AudioEncoder if audio is provided
  let audioEncoder: any = null;
  if (hasAudioTrack && audio) {
    const audioSampleRate = audio.sampleRate || 44100;
    try {
      audioEncoder = new (self as any).AudioEncoder({
        output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
        error: (e: any) => console.error('[Worker] Erro no AudioEncoder:', e),
      });

      audioEncoder.configure({
        codec: 'mp4a.40.2',
        numberOfChannels: 2,
        sampleRate: audioSampleRate,
        bitrate: 128_000,
      });

      // Feed audio chunks
      const chunkSize = 1024;
      const totalSamples = audio.leftChannel.length;
      const left = audio.leftChannel;
      const right = audio.rightChannel || left;

      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (isCancelled) break;
        const framesInChunk = Math.min(chunkSize, totalSamples - offset);
        const planar = new Float32Array(framesInChunk * 2);
        planar.set(left.subarray(offset, offset + framesInChunk), 0);
        planar.set(right.subarray(offset, offset + framesInChunk), framesInChunk);

        const audioData = new (self as any).AudioData({
          format: 'f32-planar',
          sampleRate: audioSampleRate,
          numberOfFrames: framesInChunk,
          numberOfChannels: 2,
          timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
          data: planar,
        });

        audioEncoder.encode(audioData);
        audioData.close();
      }
    } catch (aErr) {
      console.warn('[Worker] Falha ao configurar áudio no worker:', aErr);
      audioEncoder = null;
    }
  }

  // 4. OffscreenCanvas setup for main rendering
  const mainCanvas = new OffscreenCanvas(width, height);
  const mainCtx = mainCanvas.getContext('2d', { alpha: false, desynchronized: true }) as OffscreenCanvasRenderingContext2D;
  if (!mainCtx) {
    throw new Error('Não foi possível obter contexto 2D para o OffscreenCanvas.');
  }

  let currentGlobalFrame = 0;
  const startTimeMs = performance.now();
  let lastProgressReportTime = startTimeMs;
  let lastReportedFrame = 0;

  // Process frames sequentially with scene-level cache
  for (let sceneIdx = 0; sceneIdx < frames.length; sceneIdx++) {
    if (isCancelled) {
      videoEncoder.close();
      if (audioEncoder) audioEncoder.close();
      self.postMessage({ type: 'ERROR', payload: { message: 'Exportação cancelada pelo usuário.' } });
      return;
    }

    if (encoderError) {
      throw encoderError;
    }

    const scene = frames[sceneIdx];
    let mainBitmap: ImageBitmap | null = null;
    let cachedBgBitmap: ImageBitmap | null = null;

    try {
      // Decode image on demand (Anti-Memory Leak)
      mainBitmap = await createImageBitmap(scene.imageBlob);
      const imgW = mainBitmap.width || 800;
      const imgH = mainBitmap.height || 1200;

      // AJUSTE A: Downscaled Blur Cache (1 único blur de ~2ms por cena)
      const downW = width >= height ? 480 : 270;
      const downH = width >= height ? 270 : 480;
      const tempCanvas = new OffscreenCanvas(downW, downH);
      const tempCtx = tempCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

      if (tempCtx) {
        const bgScale = Math.max(downW / imgW, downH / imgH) * 1.12;
        const bgW = imgW * bgScale;
        const bgH = imgH * bgScale;
        const bgX = (downW - bgW) / 2;
        const bgY = (downH - bgH) / 2;

        tempCtx.filter = 'blur(8px) brightness(0.62)';
        tempCtx.drawImage(mainBitmap, bgX, bgY, bgW, bgH);
        tempCtx.filter = 'none';

        // Vignette overlay
        const vignette = tempCtx.createRadialGradient(
          downW / 2,
          downH / 2,
          Math.min(downW, downH) * 0.25,
          downW / 2,
          downH / 2,
          Math.max(downW, downH) * 0.8
        );
        vignette.addColorStop(0, 'rgba(0,0,0,0.05)');
        vignette.addColorStop(1, 'rgba(0,0,0,0.6)');
        tempCtx.fillStyle = vignette;
        tempCtx.fillRect(0, 0, downW, downH);

        cachedBgBitmap = tempCanvas.transferToImageBitmap();
      }

      // Render all video frames for this scene
      const numFrames = scene.durationFrames;
      for (let k = 0; k < numFrames; k++) {
        if (isCancelled) break;

        // Throttle backpressure if encoder queue is saturated
        if (videoEncoder.encodeQueueSize > 4) {
          await new Promise<void>((resolve) => {
            const checkInterval = setInterval(() => {
              if (videoEncoder.encodeQueueSize <= 2 || isCancelled) {
                clearInterval(checkInterval);
                resolve();
              }
            }, 6);
          });
        }

        const progress = numFrames > 1 ? k / (numFrames - 1) : 0;

        // 1. Draw base dark canvas
        mainCtx.fillStyle = '#08090c';
        mainCtx.fillRect(0, 0, width, height);

        // 2. Ultra-fast hardware blit of pre-rendered background
        if (cachedBgBitmap) {
          mainCtx.imageSmoothingEnabled = true;
          mainCtx.imageSmoothingQuality = 'medium';
          mainCtx.drawImage(cachedBgBitmap, 0, 0, width, height);
        }

        // 3. Foreground: Sangria Permanente (Overbleed), borda espessa de 7px e zoom seguro
        const imgAspect = imgW / imgH;
        const canvasAspect = width / height;
        const isPortraitDominant = imgAspect < canvasAspect;

        // Base de sangria permanente: no eixo dominante, a imagem já cobre 104.5% da tela.
        // As bordas superior/inferior (em retrato) ou laterais (em paisagem) já nascem fora da tela.
        let baseW: number;
        let baseH: number;
        if (isPortraitDominant) {
          baseH = height * 1.045;
          baseW = baseH * imgAspect;
        } else {
          baseW = width * 1.045;
          baseH = baseW / imgAspect;
        }

        // Animação: o piso mínimo de zoom é SEMPRE 1.0 da base (104.5%).
        // Mesmo no zoom_out, a imagem jamais encolhe abaixo da base de sangria.
        const isZoomOut = scene.transition === 'zoom_out';
        const zoomFactor = isZoomOut ? 1.04 - 0.04 * progress : 1.0 + 0.04 * progress;

        const fgW = baseW * zoomFactor;
        const fgH = baseH * zoomFactor;
        const fgX = (width - fgW) / 2;
        const fgY = (height - fgH) / 2;

        // Drop shadow
        mainCtx.save();
        mainCtx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        mainCtx.shadowBlur = Math.round(width * 0.018);
        mainCtx.shadowOffsetX = 0;
        mainCtx.shadowOffsetY = Math.round(height * 0.006);
        mainCtx.drawImage(mainBitmap, fgX, fgY, fgW, fgH);
        mainCtx.restore();

        // Borda branca mais espessa (~7px em 1080p, matching das referências de recap)
        mainCtx.save();
        mainCtx.strokeStyle = 'rgba(255, 255, 255, 0.98)';
        mainCtx.lineWidth = Math.max(6, Math.round(width * 0.0036));
        mainCtx.strokeRect(fgX, fgY, fgW, fgH);
        mainCtx.restore();

        // 4. Subtitles (if enabled)
        if (includeSubtitles && scene.subtitleText && scene.subtitleText.trim()) {
          drawSubtitlesPill(mainCtx, width, height, scene.subtitleText.trim());
        }

        // 5. Send frame to VideoEncoder
        const timestamp = Math.round((currentGlobalFrame / fps) * 1_000_000);
        const videoFrame = new (self as any).VideoFrame(mainCanvas, { timestamp });
        const isKeyFrame = currentGlobalFrame % (fps * 2) === 0;

        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();

        currentGlobalFrame++;

        // Progress report every ~8 frames
        const now = performance.now();
        if (now - lastProgressReportTime >= 120 || currentGlobalFrame === totalFrames) {
          const elapsedSec = (now - startTimeMs) / 1000;
          const framesSinceLast = currentGlobalFrame - lastReportedFrame;
          const timeSinceLast = (now - lastProgressReportTime) / 1000;
          const instantFps = timeSinceLast > 0 ? framesSinceLast / timeSinceLast : fps;
          const overallFps = elapsedSec > 0 ? currentGlobalFrame / elapsedSec : fps;
          const displayFps = Math.round(instantFps * 0.6 + overallFps * 0.4);

          const remainingFrames = Math.max(0, totalFrames - currentGlobalFrame);
          const estimatedRemainingSeconds = displayFps > 0 ? Math.round(remainingFrames / displayFps) : 0;
          const percentage = Math.min(99, Math.round((currentGlobalFrame / totalFrames) * 100));

          self.postMessage({
            type: 'PROGRESS',
            payload: {
              currentFrame: currentGlobalFrame,
              totalFrames,
              percentage,
              fps: displayFps,
              elapsedSeconds: Math.round(elapsedSec),
              estimatedRemainingSeconds,
              stage: 'encoding',
            },
          });

          lastProgressReportTime = now;
          lastReportedFrame = currentGlobalFrame;
        }
      }
    } finally {
      // Explicit GPU VRAM deallocation
      if (cachedBgBitmap) {
        cachedBgBitmap.close();
      }
      if (mainBitmap) {
        mainBitmap.close();
      }
    }
  }

  if (isCancelled) {
    videoEncoder.close();
    if (audioEncoder) audioEncoder.close();
    return;
  }

  // 5. Finalize Encoding and Muxing
  self.postMessage({
    type: 'PROGRESS',
    payload: {
      currentFrame: totalFrames,
      totalFrames,
      percentage: 99,
      fps: 0,
      elapsedSeconds: Math.round((performance.now() - startTimeMs) / 1000),
      estimatedRemainingSeconds: 0,
      stage: 'muxing',
    },
  });

  await videoEncoder.flush();
  videoEncoder.close();

  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
  }

  muxer.finalize();

  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  const mp4Blob = new Blob([buffer], { type: 'video/mp4' });
  const durationSeconds = totalFrames / fps;

  self.postMessage({
    type: 'SUCCESS',
    payload: {
      mp4Blob,
      durationSeconds,
      totalFrames,
      fileSizeBytes: mp4Blob.size,
    },
  });
}

/**
 * Draws rounded pill subtitle with word-wrap
 */
function drawSubtitlesPill(
  ctx: OffscreenCanvasRenderingContext2D,
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
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxTextWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.35;
  const paddingX = Math.round(fontSize * 0.9);
  const paddingY = Math.round(fontSize * 0.45);
  const totalBoxHeight = lines.length * lineHeight + paddingY * 2;
  const boxY = height - totalBoxHeight - Math.round(height * 0.065);

  let maxMeasuredLineWidth = 0;
  for (const line of lines) {
    const m = ctx.measureText(line);
    if (m.width > maxMeasuredLineWidth) maxMeasuredLineWidth = m.width;
  }
  const totalBoxWidth = Math.min(width * 0.88, maxMeasuredLineWidth + paddingX * 2);
  const boxX = (width - totalBoxWidth) / 2;

  // Background pill
  ctx.fillStyle = 'rgba(8, 10, 16, 0.85)';
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === 'function') {
    (ctx as any).roundRect(boxX, boxY, totalBoxWidth, totalBoxHeight, 10);
  } else {
    ctx.rect(boxX, boxY, totalBoxWidth, totalBoxHeight);
  }
  ctx.fill();

  // Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Text
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  lines.forEach((line, index) => {
    const lineY = boxY + paddingY + (index + 0.5) * lineHeight;
    ctx.fillText(line, width / 2, lineY);
  });

  ctx.restore();
}
