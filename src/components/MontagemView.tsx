import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Scissors,
  ZoomIn,
  ZoomOut,
  Image as ImageIcon,
  Mic,
  Sparkles,
  Clock,
  Trash2,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  FileText,
  GripVertical,
  Layers,
  Film,
  Sliders,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { ChapterItem, FrameItem, SceneItem } from '../types';
import { FramingMode, FRAMING_MODES } from '../utils/videoRenderer';

interface MontagemViewProps {
  chapters?: ChapterItem[];
  frames: FrameItem[];
  scenes: SceneItem[];
  onExportRecap: (format?: 'mp4' | 'webm' | 'shotcut' | string) => void;
  onUpdateFrameDuration?: (frameId: string, duration: number) => void;
  onReorderFrames?: (newFrames: FrameItem[]) => void;
  onRemoveFrame?: (frameId: string) => void;
  onGoToRecorte?: () => void;
  onGoToNarracao?: () => void;
}

const TRANSITIONS = [
  { name: 'Zoom dinâmico', hint: 'Ken burns' },
  { name: 'Fade suave', hint: '0.4s' },
  { name: 'Flash branco', hint: 'Impacto' },
  { name: 'Corte seco', hint: '0s' },
];

interface PageGroup {
  chapterId: string;
  chapterLabel: string;
  pageNumber: number;
  startTime: number;
  duration: number;
  frames: FrameItem[];
  startIndex: number;
}

interface ChapterGroup {
  chapterId: string;
  chapterLabel: string;
  startTime: number;
  duration: number;
  pageGroups: PageGroup[];
  totalFrames: number;
}

export const MontagemView: React.FC<MontagemViewProps> = ({
  chapters = [],
  frames,
  scenes,
  onExportRecap,
  onUpdateFrameDuration,
  onReorderFrames,
  onRemoveFrame,
  onGoToRecorte,
  onGoToNarracao,
}) => {
  const [timelineZoom, setTimelineZoom] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [selectedTransition, setSelectedTransition] = useState<string>('Zoom dinâmico');
  const [quickVideoFormat, setQuickVideoFormat] = useState<'mp4' | 'webm' | 'shotcut'>('mp4');
  const [previewFramingMode, setPreviewFramingMode] = useState<FramingMode>('blurred_pillarbox');
  const [previewAspect, setPreviewAspect] = useState<'16:9' | '9:16'>('16:9');
  const [enableTtsPlayback, setEnableTtsPlayback] = useState<boolean>(true);
  const [playingClipAudioId, setPlayingClipAudioId] = useState<string | null>(null);
  const lastSpokenSceneIdRef = useRef<string | null>(null);

  // Drag and drop state for timeline frames
  const [draggedFrameIndex, setDraggedFrameIndex] = useState<number | null>(null);
  const [dragOverFrameIndex, setDragOverFrameIndex] = useState<number | null>(null);

  // Playhead scrubbing state
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const timelineTracksRef = useRef<HTMLDivElement>(null);

  // Map chapter labels for lookup
  const chapterMap = new Map(chapters.map((ch, idx) => [ch.id, { label: ch.label, order: idx }]));

  // Compute total duration dynamically from frames
  const totalDuration = Math.max(
    1,
    frames.reduce((acc, f) => acc + (f.duration || 4), 0)
  );

  // Pixels per second for exact timeline math
  const pixelsPerSecond = 32 * timelineZoom;

  // Handle Playback Loop
  useEffect(() => {
    let interval: any = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTime((t) => {
          if (t >= totalDuration) {
            setIsPlaying(false);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            return 0;
          }
          return Number((t + 0.1).toFixed(1));
        });
      }, 100);
    } else {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    }
    return () => clearInterval(interval);
  }, [isPlaying, totalDuration]);

  // Determine which frame is active at currentTime
  let accumulatedTime = 0;
  let activeFrameIndex = 0;
  for (let i = 0; i < frames.length; i++) {
    const dur = frames[i].duration || 4;
    accumulatedTime += dur;
    if (currentTime <= accumulatedTime) {
      activeFrameIndex = i;
      break;
    }
  }
  const activeFrame = frames[activeFrameIndex] || frames[0] || null;

  // Find active scene strictly matching activeFrame's chapter and page
  const activeScene =
    (activeFrame
      ? scenes.find(
          (s) =>
            (s.chapterId && activeFrame.chapterId && s.pageNumber && activeFrame.pageNumber &&
              s.chapterId === activeFrame.chapterId && s.pageNumber === activeFrame.pageNumber) ||
            s.frames?.some((sf) => sf.id === activeFrame.id)
        )
      : null) ||
    (scenes.length > 0
      ? scenes[Math.min(scenes.length - 1, Math.floor((currentTime / totalDuration) * scenes.length))]
      : null);

  const montagemAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio();
    montagemAudioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Individual audio preview handler for clips on the timeline
  const handlePlayClipAudio = (audioUrl: string, id: string) => {
    if (!montagemAudioRef.current) return;
    if (playingClipAudioId === id && !montagemAudioRef.current.paused) {
      montagemAudioRef.current.pause();
      setPlayingClipAudioId(null);
    } else {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      montagemAudioRef.current.src = audioUrl;
      montagemAudioRef.current.currentTime = 0;
      montagemAudioRef.current
        .play()
        .then(() => {
          setPlayingClipAudioId(id);
        })
        .catch(() => {});
      montagemAudioRef.current.onended = () => {
        setPlayingClipAudioId(null);
      };
    }
  };

  // Speak / play active scene audio or fallback TTS text if toggle is enabled during playback
  useEffect(() => {
    if (isPlaying && enableTtsPlayback && activeScene && activeScene.id !== lastSpokenSceneIdRef.current) {
      lastSpokenSceneIdRef.current = activeScene.id;
      if (activeScene.audioUrl && montagemAudioRef.current) {
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        montagemAudioRef.current.src = activeScene.audioUrl;
        montagemAudioRef.current.currentTime = 0;
        montagemAudioRef.current.play().catch(() => {});
      } else if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(activeScene.text);
        utter.lang = 'pt-BR';
        utter.rate = 1.15;
        window.speechSynthesis.speak(utter);
      }
    }
    if (!isPlaying) {
      lastSpokenSceneIdRef.current = null;
      if (montagemAudioRef.current && !montagemAudioRef.current.paused && !playingClipAudioId) {
        montagemAudioRef.current.pause();
      }
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }
  }, [isPlaying, enableTtsPlayback, activeScene, playingClipAudioId]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Move frame left or right in sequence
  const handleMoveFrame = (idx: number, direction: 'left' | 'right') => {
    if (!onReorderFrames) return;
    const targetIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= frames.length) return;

    const newArr = [...frames];
    const temp = newArr[idx];
    newArr[idx] = newArr[targetIdx];
    newArr[targetIdx] = temp;
    onReorderFrames(newArr);
  };

  // Change frame duration
  const handleChangeDuration = (frameId: string, currentDur: number, delta: number) => {
    if (!onUpdateFrameDuration) return;
    const newDur = Math.max(1, Math.min(15, currentDur + delta));
    onUpdateFrameDuration(frameId, newDur);
  };

  // Sort frames strictly in natural chronological order (Chapter 1 -> 2; Page 1 -> 2; Frame 1 -> 2)
  const handleSortChronologically = () => {
    if (!onReorderFrames) return;
    const chapterOrderMap = new Map(chapters.map((ch, idx) => [ch.id, idx]));
    const sorted = [...frames].sort((a, b) => {
      const chA = chapterOrderMap.has(a.chapterId || '') ? chapterOrderMap.get(a.chapterId || '')! : 999;
      const chB = chapterOrderMap.has(b.chapterId || '') ? chapterOrderMap.get(b.chapterId || '')! : 999;
      if (chA !== chB) return chA - chB;

      const pageA = a.pageNumber || 0;
      const pageB = b.pageNumber || 0;
      if (pageA !== pageB) return pageA - pageB;

      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
    });
    onReorderFrames(sorted);
  };

  // Build consecutive Chapter and Page Groupers from timeline frames
  const chapterGroups: ChapterGroup[] = [];
  let currentTimeCursor = 0;

  for (let idx = 0; idx < frames.length; idx++) {
    const f = frames[idx];
    const chId = f.chapterId || 'default_ch';
    const chLabel = (f.chapterId && chapterMap.get(f.chapterId)?.label) || 'Capítulo 01';
    const pNum = f.pageNumber || 1;
    const dur = f.duration || 4;

    let lastChapter = chapterGroups[chapterGroups.length - 1];
    if (!lastChapter || lastChapter.chapterId !== chId) {
      lastChapter = {
        chapterId: chId,
        chapterLabel: chLabel,
        startTime: currentTimeCursor,
        duration: 0,
        pageGroups: [],
        totalFrames: 0,
      };
      chapterGroups.push(lastChapter);
    }

    lastChapter.duration += dur;
    lastChapter.totalFrames += 1;

    let lastPage = lastChapter.pageGroups[lastChapter.pageGroups.length - 1];
    if (!lastPage || lastPage.pageNumber !== pNum) {
      lastPage = {
        chapterId: chId,
        chapterLabel: chLabel,
        pageNumber: pNum,
        startTime: currentTimeCursor,
        duration: 0,
        frames: [],
        startIndex: idx,
      };
      lastChapter.pageGroups.push(lastPage);
    }

    lastPage.duration += dur;
    lastPage.frames.push(f);

    currentTimeCursor += dur;
  }

  // Playhead scrubber drag handler
  const handleScrubMove = (clientX: number) => {
    if (!timelineTracksRef.current) return;
    const rect = timelineTracksRef.current.getBoundingClientRect();
    const scrollLeft = timelineTracksRef.current.scrollLeft;
    // 88px offset for track label sidebar
    const contentX = clientX - rect.left + scrollLeft - 88;
    const newTime = Math.max(0, Math.min(totalDuration, contentX / pixelsPerSecond));
    setCurrentTime(Number(newTime.toFixed(1)));
  };

  const handlePointerDownRuler = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsScrubbing(true);
    handleScrubMove(e.clientX);
  };

  // Global listeners for dragging playhead smoothly
  useEffect(() => {
    if (!isScrubbing) return;
    const onPointerMove = (e: PointerEvent) => {
      handleScrubMove(e.clientX);
    };
    const onPointerUp = () => {
      setIsScrubbing(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isScrubbing, totalDuration, pixelsPerSecond]);

  // If no frames exist yet
  if (frames.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[calc(100vh-61px)]">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
          <ImageIcon className="h-8 w-8" />
        </div>
        <h2 className="font-display text-xl font-bold text-foreground">
          Nenhum quadro na timeline
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground leading-relaxed">
          Para montar o seu recap e assistir à pré-visualização, faça o recorte dos quadros na aba 'Recorte'.
        </p>
        <div className="mt-6 flex items-center gap-3">
          {onGoToRecorte && (
            <button
              onClick={onGoToRecorte}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow"
            >
              <Scissors className="h-4 w-4" />
              <span>Ir para Recortes</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const timelineContentWidth = Math.max(900, totalDuration * pixelsPerSecond);

  return (
    <div className="flex-1 flex flex-col min-h-[calc(100vh-61px)] select-none">
      {/* Top Workspace Grid: Preview Player & Settings */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] flex-1">
        {/* Main Preview Player Area */}
        <div className="flex flex-col items-center justify-center bg-background/50 p-6 border-b border-border xl:border-b-0">
          {/* Top Quick Framing & Ratio Controls */}
          <div className="mb-3 flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 bg-card border border-border p-1 rounded-lg text-xs shadow-xs">
              <span className="text-[11px] font-semibold text-muted-foreground px-1.5 hidden sm:inline">
                Enquadramento:
              </span>
              <button
                type="button"
                onClick={() => setPreviewFramingMode('blurred_pillarbox')}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  previewFramingMode === 'blurred_pillarbox'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title="Fit real centralizado com fundo desfocado dinâmico (não corta imagens verticais de manhwa)"
              >
                <Sparkles className="h-3 w-3" />
                <span>Fundo Desfocado (Manhwa)</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewFramingMode('cover')}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  previewFramingMode === 'cover'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title="Preencher tela cheia com corte/zoom"
              >
                Cover
              </button>
              <button
                type="button"
                onClick={() => setPreviewFramingMode('contain_black')}
                className={`px-2 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  previewFramingMode === 'contain_black'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
                title="Barras pretas sólidas"
              >
                Barras
              </button>
            </div>

            {/* Aspect Ratio Switcher */}
            <div className="flex items-center gap-1 bg-card border border-border p-1 rounded-lg text-xs shadow-xs">
              <button
                type="button"
                onClick={() => setPreviewAspect('16:9')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  previewAspect === '16:9'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Proporção 16:9 (YouTube)"
              >
                <Monitor className="h-3 w-3" />
                <span>16:9</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewAspect('9:16')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                  previewAspect === '9:16'
                    ? 'bg-secondary text-foreground font-bold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Proporção 9:16 (Shorts / Reels)"
              >
                <Smartphone className="h-3 w-3" />
                <span>9:16</span>
              </button>
            </div>
          </div>

          {/* Video Canvas Mockup with Dynamic Aspect Ratio */}
          <div
            className={`relative overflow-hidden rounded-xl border border-border bg-black shadow-2xl flex items-center justify-center transition-all duration-300 ${
              previewAspect === '16:9'
                ? 'aspect-video w-full max-w-3xl'
                : 'aspect-[9/16] w-full max-w-[320px] max-h-[500px]'
            }`}
          >
            {activeFrame ? (
              <div className="relative w-full h-full overflow-hidden flex items-center justify-center select-none">
                {previewFramingMode === 'blurred_pillarbox' ? (
                  <>
                    {/* 1. Camada de Fundo (Background Layer): Fundo Desfocado Dinâmico (Pillarbox) */}
                    <div
                      className="absolute inset-0 -m-6 overflow-hidden pointer-events-none select-none"
                      aria-hidden="true"
                    >
                      <img
                        src={activeFrame.src}
                        alt=""
                        className="w-full h-full object-cover scale-115 filter blur-[32px] opacity-80 transition-all duration-1000 transform-gpu"
                      />
                      {/* Leve escurecimento / overlay de contraste (20%-30%) */}
                      <div className="absolute inset-0 bg-black/28" />
                    </div>

                    {/* 2. Camada Principal (Foreground Layer): Proporção Real, Fit 96% e Sombra Suave */}
                    <div className="relative z-1 h-full w-full flex items-center justify-center p-2.5">
                      <img
                        src={activeFrame.src}
                        alt={activeFrame.label}
                        className={`max-h-[96%] max-w-full object-contain rounded-xs shadow-[0_16px_40px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition-all duration-1000 ${
                          isPlaying
                            ? activeFrame.transition === 'zoom_in'
                              ? 'scale-104'
                              : activeFrame.transition === 'zoom_out'
                              ? 'scale-96'
                              : activeFrame.transition === 'pan_down'
                              ? 'translate-y-1 scale-102'
                              : activeFrame.transition === 'fade'
                              ? 'animate-fade-in'
                              : selectedTransition === 'Zoom dinâmico'
                              ? 'scale-104'
                              : 'scale-100'
                            : 'scale-100'
                        }`}
                      />
                    </div>
                  </>
                ) : previewFramingMode === 'cover' ? (
                  <img
                    src={activeFrame.src}
                    alt={activeFrame.label}
                    className={`w-full h-full object-cover transition-all duration-1000 ${
                      isPlaying
                        ? activeFrame.transition === 'zoom_in'
                          ? 'scale-115'
                          : activeFrame.transition === 'zoom_out'
                          ? 'scale-95'
                          : activeFrame.transition === 'pan_down'
                          ? 'translate-y-2 scale-105'
                          : activeFrame.transition === 'fade'
                          ? 'animate-fade-in'
                          : selectedTransition === 'Zoom dinâmico'
                          ? 'scale-110'
                          : 'scale-100'
                        : 'scale-100'
                    }`}
                  />
                ) : (
                  <div className="relative z-1 h-full w-full flex items-center justify-center p-2.5 bg-black">
                    <img
                      src={activeFrame.src}
                      alt={activeFrame.label}
                      className="max-h-[96%] max-w-full object-contain"
                    />
                  </div>
                )}

                {/* Subtitle Box at Bottom of Player if active scene text exists */}
                {activeScene?.text && (
                  <div className="absolute bottom-3 left-4 right-4 z-10 flex justify-center pointer-events-none">
                    <div className="max-w-[85%] rounded-lg bg-black/80 backdrop-blur-md px-3.5 py-1.5 border border-white/15 shadow-xl text-center">
                      <p className="text-white text-xs sm:text-sm font-medium drop-shadow-md line-clamp-2">
                        {activeScene.text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Nenhum quadro ativo</p>
              </div>
            )}

            {/* Floating Top Info Overlay: Chapter, Page and Audio Badge */}
            {activeFrame && (
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <span className="px-2.5 py-1 rounded bg-black/75 text-white text-[11px] font-semibold backdrop-blur border border-white/15 shadow flex items-center gap-1.5">
                  <FolderOpen className="h-3 w-3 text-primary" />
                  {activeFrame.chapterId && chapterMap.get(activeFrame.chapterId)?.label
                    ? chapterMap.get(activeFrame.chapterId)!.label
                    : 'Capítulo'}
                </span>
                <span className="px-2 py-1 rounded bg-black/75 text-white text-[11px] font-mono backdrop-blur border border-white/15 shadow">
                  Pág {activeFrame.pageNumber || 1}
                </span>

                {/* AI Audio Status in Player Overlay */}
                {activeScene?.audioUrl ? (
                  <span className="px-2.5 py-1 rounded bg-emerald-950/85 text-emerald-300 text-[11px] font-semibold backdrop-blur border border-emerald-500/40 shadow flex items-center gap-1.5 animate-fade-in">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <Volume2 className="h-3 w-3 text-emerald-400" />
                    <span>Áudio IA Pronto</span>
                    {activeScene.audioDuration && (
                      <span className="font-mono text-[10px] text-emerald-400/80">
                        ({activeScene.audioDuration.toFixed(1)}s)
                      </span>
                    )}
                  </span>
                ) : activeScene?.text ? (
                  <span className="px-2 py-1 rounded bg-amber-950/80 text-amber-300 text-[11px] font-medium backdrop-blur border border-amber-500/40 shadow flex items-center gap-1.5">
                    <VolumeX className="h-3 w-3 text-amber-400" />
                    <span>Voz Navegador</span>
                  </span>
                ) : null}
              </div>
            )}

            {/* Floating Top Right Timecode */}
            <div className="absolute top-4 right-4 z-10 rounded bg-black/75 px-2.5 py-1 text-xs font-mono font-bold text-white backdrop-blur border border-white/15">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </div>
          </div>

          {/* Player Controls Bar */}
          <div className="mt-4 flex w-full max-w-3xl items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-md">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow"
              title={isPlaying ? 'Pausar reprodução' : 'Reproduzir timeline'}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
            </button>

            <button
              onClick={() => {
                setCurrentTime(0);
                setIsPlaying(false);
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
              }}
              className="grid h-8 w-8 place-items-center rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer"
              title="Voltar ao início"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => setEnableTtsPlayback(!enableTtsPlayback)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-semibold transition-colors cursor-pointer ${
                enableTtsPlayback
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-bold'
                  : 'border-border bg-card hover:bg-secondary text-muted-foreground'
              }`}
              title="Ativar/desativar reprodução da locução neural IA"
            >
              {enableTtsPlayback ? (
                <>
                  <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Áudio IA Ativo</span>
                </>
              ) : (
                <>
                  <VolumeX className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Áudio Desativado</span>
                </>
              )}
            </button>

            {/* Scrubber Progress Bar */}
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                setCurrentTime(Number((pos * totalDuration).toFixed(1)));
              }}
              className="min-w-0 flex-1 cursor-pointer py-2"
            >
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-75"
                  style={{ width: `${(currentTime / totalDuration) * 100}%` }}
                />
              </div>
            </div>

            <span className="shrink-0 font-display text-xs font-mono text-muted-foreground">
              {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>
          </div>
        </div>

        {/* Right Sidebar: Transições & Detalhes do Quadro */}
        <aside className="border-t border-border bg-sidebar p-4 xl:border-t-0 xl:border-l xl:overflow-y-auto space-y-5">
          {/* Quadro Ativo Detalhes */}
          {activeFrame && (
            <div className="rounded-lg border border-border bg-card p-3.5 space-y-2.5 text-xs shadow-sm">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <span>Quadro em Exibição</span>
                </p>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                  {activeFrameIndex + 1} de {frames.length}
                </span>
              </div>

              <div className="relative h-32 w-full rounded-md overflow-hidden border border-border bg-black/20">
                <img
                  src={activeFrame.src}
                  alt={activeFrame.label}
                  className="w-full h-full object-cover"
                />
              </div>

              <div>
                <p className="font-bold text-foreground truncate">{activeFrame.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {activeFrame.chapterId && chapterMap.get(activeFrame.chapterId)?.label
                    ? chapterMap.get(activeFrame.chapterId)!.label
                    : 'Capítulo'}
                  {' · '}Página {activeFrame.pageNumber || 1}
                </p>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-border text-[11px] text-muted-foreground">
                <span>Duração do Quadro:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleChangeDuration(activeFrame.id, activeFrame.duration || 4, -1)}
                    className="h-5 w-5 rounded bg-secondary hover:bg-secondary/80 text-foreground font-bold flex items-center justify-center cursor-pointer"
                    title="Diminuir 1s"
                  >
                    -
                  </button>
                  <span className="font-mono text-primary font-bold text-xs">{activeFrame.duration || 4}s</span>
                  <button
                    onClick={() => handleChangeDuration(activeFrame.id, activeFrame.duration || 4, 1)}
                    className="h-5 w-5 rounded bg-secondary hover:bg-secondary/80 text-foreground font-bold flex items-center justify-center cursor-pointer"
                    title="Aumentar 1s"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Efeito de Transição */}
          <div>
            <p className="font-display text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Efeito de Transição
            </p>
            <div className="mt-2.5 space-y-1.5">
              {TRANSITIONS.map((t) => {
                const isSelected = selectedTransition === t.name;
                return (
                  <button
                    key={t.name}
                    onClick={() => setSelectedTransition(t.name)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-md border text-xs transition-colors cursor-pointer text-left ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-border bg-card text-foreground hover:bg-secondary'
                    }`}
                  >
                    <span>{t.name}</span>
                    <span className="text-[10px] text-muted-foreground">{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Painel de Exportação de Vídeo Multi-formato */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="font-display text-xs font-bold text-foreground flex items-center gap-1.5 uppercase tracking-wider">
                <Film className="h-3.5 w-3.5 text-primary" />
                <span>Exportar Vídeo</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold">
                Multi-formato
              </span>
            </div>

            {/* Formatos de Saída */}
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">
                Formato de Exportação:
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { id: 'mp4', name: 'MP4 (WebCodecs GPU)', badge: 'Recomendado' },
                  { id: 'webm', name: 'WebM (Universal)', badge: 'Leve' },
                  { id: 'shotcut', name: 'Shotcut (.mlt + ZIP)', badge: 'Edição Externa' },
                ].map((f) => {
                  const isFmtSelected = quickVideoFormat === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setQuickVideoFormat(f.id as any)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                        isFmtSelected
                          ? 'border-primary bg-primary text-primary-foreground shadow-xs'
                          : 'border-border bg-card text-foreground hover:bg-secondary'
                      }`}
                    >
                      <span>{f.name}</span>
                      <span
                        className={`text-[9px] ${
                          isFmtSelected
                            ? 'text-primary-foreground/90 font-medium'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {f.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Resumo da Produção */}
            <div className="p-2.5 rounded-lg bg-card border border-border text-[11px] text-muted-foreground space-y-1 font-mono">
              <div className="flex justify-between">
                <span>Duração Total:</span>
                <span className="font-bold text-foreground">{formatTime(totalDuration)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total de Quadros:</span>
                <span className="font-bold text-foreground">{frames.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Narração Pronta:</span>
                <span className="font-bold text-primary">
                  {scenes.filter((s) => s.audioUrl).length} de {scenes.length} cenas
                </span>
              </div>
            </div>

            {/* Botão Principal de Exportação */}
            <button
              onClick={() => onExportRecap(quickVideoFormat)}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer shadow-md"
            >
              <Film className="h-4 w-4" />
              <span>
                {quickVideoFormat === 'shotcut'
                  ? 'Exportar Projeto Shotcut (.ZIP)'
                  : `Exportar Vídeo (.${quickVideoFormat.toUpperCase()})`}
              </span>
            </button>

            {/* Botão de Opções Avançadas */}
            <button
              onClick={() => onExportRecap(quickVideoFormat)}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Central de Exportação & Ajustes...</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Bottom Timeline Multi-Track Editor Section */}
      <div className="border-t border-border bg-sidebar flex flex-col">
        {/* Timeline Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2 select-none">
          <div className="flex items-center gap-2">
            <span className="font-display text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Timeline de Montagem
            </span>
            <span className="text-[11px] text-muted-foreground">
              ({frames.length} quadros em {chapterGroups.length} capítulo(s))
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Export Button in Timeline Header */}
            <button
              onClick={() => onExportRecap(quickVideoFormat)}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow-xs cursor-pointer"
              title={`Renderizar e baixar vídeo em .${quickVideoFormat.toUpperCase()}`}
            >
              <Film className="h-3.5 w-3.5" />
              <span>Exportar Vídeo ({quickVideoFormat.toUpperCase()})</span>
            </button>

            {/* Auto Sort Chronologically */}
            <button
              onClick={handleSortChronologically}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border bg-card hover:bg-secondary text-foreground transition-colors shadow-sm cursor-pointer"
              title="Organizar todos os quadros na ordem cronológica (Capítulo 01 -> 02, Página 01 -> 02)"
            >
              <RotateCcw className="h-3 w-3 text-primary" />
              <span>Ordem Cronológica</span>
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 bg-card border border-border rounded-md p-0.5">
              <button
                onClick={() => setTimelineZoom((z) => Math.max(0.6, z - 0.2))}
                className="grid h-6 w-6 place-items-center rounded hover:bg-secondary transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                title="Reduzir zoom da timeline"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="text-[10px] font-mono text-muted-foreground px-1">
                {Math.round(timelineZoom * 100)}%
              </span>
              <button
                onClick={() => setTimelineZoom((z) => Math.min(2.5, z + 0.2))}
                className="grid h-6 w-6 place-items-center rounded hover:bg-secondary transition-colors cursor-pointer text-muted-foreground hover:text-foreground"
                title="Aumentar zoom da timeline"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Tracks Scrollable Container */}
        <div
          ref={timelineTracksRef}
          className="overflow-x-auto p-4 relative"
        >
          <div
            style={{ width: `${88 + timelineContentWidth}px`, minWidth: '100%' }}
            className="relative"
          >
            {/* Timeline Ruler & Scrubbing Zone */}
            <div
              onPointerDown={handlePointerDownRuler}
              className="mb-2 flex h-7 items-end border-b border-border pl-[88px] select-none cursor-ew-resize relative group"
            >
              {Array.from({ length: Math.ceil(totalDuration / 2) + 2 }).map((_, idx) => {
                const tSec = idx * 2;
                return (
                  <div
                    key={idx}
                    className="absolute border-l border-border/80 pl-1 bottom-0 h-4"
                    style={{ left: `${88 + tSec * pixelsPerSecond}px` }}
                  >
                    <span className="font-display text-[9px] text-muted-foreground font-mono">
                      {formatTime(tSec)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* TRACK 0: Agrupador de Capítulos */}
            <div className="mb-2 flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1 text-[11px] font-semibold text-primary select-none">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Capítulo</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 p-0.5">
                {chapterGroups.map((chGroup, cIdx) => {
                  const widthPx = chGroup.duration * pixelsPerSecond;
                  return (
                    <div
                      key={`ch_grp_${chGroup.chapterId}_${cIdx}`}
                      style={{ width: `${Math.max(60, widthPx)}px` }}
                      className="h-7 shrink-0 rounded-md border border-primary/30 bg-primary/10 px-2.5 flex items-center justify-between text-xs font-bold text-primary shadow-xs overflow-hidden"
                      title={`${chGroup.chapterLabel}: ${chGroup.totalFrames} quadros (${chGroup.duration}s)`}
                    >
                      <span className="truncate flex items-center gap-1.5">
                        <FolderOpen className="h-3 w-3 shrink-0" />
                        {chGroup.chapterLabel}
                      </span>
                      <span className="text-[10px] font-mono text-primary/80 shrink-0 ml-2">
                        {chGroup.duration}s
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TRACK 0.5: Agrupador de Páginas */}
            <div className="mb-3 flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground select-none">
                <FileText className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                <span className="truncate">Páginas</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 p-0.5">
                {chapterGroups.flatMap((chGroup) =>
                  chGroup.pageGroups.map((pGroup, pIdx) => {
                    const widthPx = pGroup.duration * pixelsPerSecond;
                    return (
                      <div
                        key={`page_grp_${pGroup.chapterId}_p${pGroup.pageNumber}_${pIdx}`}
                        style={{ width: `${Math.max(50, widthPx)}px` }}
                        className="h-6 shrink-0 rounded border border-blue-500/25 bg-blue-500/10 px-2 flex items-center justify-between text-[11px] font-semibold text-blue-300 shadow-xs overflow-hidden"
                        title={`${pGroup.chapterLabel} — Página ${pGroup.pageNumber}: ${pGroup.frames.length} cenas (${pGroup.duration}s)`}
                      >
                        <span className="truncate">Pág {pGroup.pageNumber}</span>
                        <span className="text-[9px] font-mono opacity-80 shrink-0 ml-1">
                          {pGroup.duration}s
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* TRACK 1: Quadros (Cenas Recortadas) com Drag and Drop */}
            <div className="mb-3 flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1 text-[11px] text-muted-foreground select-none">
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="truncate font-semibold">Quadros</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background/60 p-1.5 border border-border/50">
                {frames.map((frame, idx) => {
                  const isSelected = idx === activeFrameIndex;
                  const dur = frame.duration || 4;
                  const frameWidth = dur * pixelsPerSecond;
                  const isDraggingThis = draggedFrameIndex === idx;
                  const isOverThis = dragOverFrameIndex === idx;

                  return (
                    <div
                      key={frame.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggedFrameIndex(idx);
                        e.dataTransfer.setData('text/plain', String(idx));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverFrameIndex !== idx) {
                          setDragOverFrameIndex(idx);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverFrameIndex === idx) {
                          setDragOverFrameIndex(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (draggedFrameIndex === null || draggedFrameIndex === idx) {
                          setDraggedFrameIndex(null);
                          setDragOverFrameIndex(null);
                          return;
                        }
                        const newArr = [...frames];
                        const [movedItem] = newArr.splice(draggedFrameIndex, 1);
                        newArr.splice(idx, 0, movedItem);
                        onReorderFrames?.(newArr);
                        setDraggedFrameIndex(null);
                        setDragOverFrameIndex(null);
                      }}
                      onDragEnd={() => {
                        setDraggedFrameIndex(null);
                        setDragOverFrameIndex(null);
                      }}
                      className={`group relative h-20 shrink-0 overflow-hidden rounded-md border transition-all cursor-grab active:cursor-grabbing select-none ${
                        isDraggingThis
                          ? 'opacity-30 scale-95 border-dashed border-primary'
                          : isOverThis
                          ? 'border-primary ring-2 ring-primary scale-105 z-20'
                          : isSelected
                          ? 'border-primary ring-2 ring-primary/80 z-10 shadow-lg'
                          : 'border-border/80 hover:border-amber-400/80 bg-black/40'
                      }`}
                      style={{ width: `${Math.max(65, frameWidth)}px` }}
                      title={`${frame.label} (Arraste para reordenar)`}
                    >
                      <img
                        src={frame.src}
                        alt={frame.label}
                        loading="lazy"
                        className="h-full w-full object-cover opacity-85 pointer-events-none"
                      />

                      {/* Drag Handle Indicator Icon on Top Left */}
                      <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 rounded p-0.5 text-white">
                        <GripVertical className="h-3 w-3" />
                      </div>

                      {/* Remove Button on Top Right */}
                      {onRemoveFrame && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveFrame(frame.id);
                          }}
                          className="absolute top-1 right-1 h-4 w-4 rounded bg-black/80 hover:bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Remover quadro da timeline"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      )}

                      {/* Title & Duration badge */}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/80 px-1.5 py-0.5 text-[9px] text-foreground font-mono">
                        <span className="truncate max-w-[80px]">{frame.label}</span>
                        <span className="text-amber-400 font-bold ml-1">{dur}s</span>
                      </div>

                      {/* Quick Duration Controls on Hover */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                        {idx > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveFrame(idx, 'left');
                            }}
                            className="h-5 w-5 rounded bg-black/80 hover:bg-primary text-white flex items-center justify-center cursor-pointer"
                            title="Mover quadro para a esquerda"
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChangeDuration(frame.id, dur, -1);
                          }}
                          className="h-5 w-5 rounded bg-black/80 hover:bg-secondary text-white text-[10px] font-bold flex items-center justify-center cursor-pointer"
                          title="Diminuir duração (-1s)"
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChangeDuration(frame.id, dur, 1);
                          }}
                          className="h-5 w-5 rounded bg-black/80 hover:bg-secondary text-white text-[10px] font-bold flex items-center justify-center cursor-pointer"
                          title="Aumentar duração (+1s)"
                        >
                          +
                        </button>

                        {idx < frames.length - 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveFrame(idx, 'right');
                            }}
                            className="h-5 w-5 rounded bg-black/80 hover:bg-primary text-white flex items-center justify-center cursor-pointer"
                            title="Mover quadro para a direita"
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* TRACK 2: Áudio da Narração IA (Locução Neural) */}
            <div className="mb-3 flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1 text-[11px] text-muted-foreground select-none">
                <Volume2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span className="truncate font-semibold">Áudio IA</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background/60 p-1.5 border border-border/50">
                {chapterGroups.flatMap((chGroup) =>
                  chGroup.pageGroups.map((pGroup, pIdx) => {
                    const widthPx = Math.max(65, pGroup.duration * pixelsPerSecond);
                    const pageScene =
                      scenes.find(
                        (s) =>
                          (s.chapterId && s.chapterId === pGroup.chapterId && s.pageNumber && s.pageNumber === pGroup.pageNumber) ||
                          s.frames?.some((sf) => pGroup.frames.some((pf) => pf.id === sf.id))
                      ) || scenes.find((s) => s.pageNumber === pGroup.pageNumber);

                    const hasAudio = Boolean(pageScene?.audioUrl);
                    const hasText = Boolean(pageScene?.text?.trim());
                    const isClipPlaying = pageScene && playingClipAudioId === pageScene.id;

                    return (
                      <div
                        key={`audio_track_${chGroup.chapterId}_p${pGroup.pageNumber}_${pIdx}`}
                        style={{ width: `${widthPx}px` }}
                        className={`flex h-12 shrink-0 items-center justify-between gap-1.5 overflow-hidden rounded-md border px-2 py-1 text-xs shadow-xs transition-colors ${
                          hasAudio
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                            : hasText
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : 'border-border/50 bg-secondary/30 text-muted-foreground'
                        }`}
                        title={
                          pageScene
                            ? `Página ${pGroup.pageNumber}: ${pageScene.text || 'Sem texto'}`
                            : `Página ${pGroup.pageNumber}: Sem cena de narração associada`
                        }
                      >
                        <div className="flex items-center gap-1.5 truncate min-w-0">
                          {hasAudio ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (pageScene && pageScene.audioUrl) {
                                  handlePlayClipAudio(pageScene.audioUrl, pageScene.id);
                                }
                              }}
                              className="h-6 w-6 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 cursor-pointer shadow-xs"
                              title={isClipPlaying ? 'Pausar áudio IA' : 'Ouvir áudio IA desta página'}
                            >
                              {isClipPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-0.5" />}
                            </button>
                          ) : (
                            <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-40" />
                          )}

                          <div className="truncate min-w-0">
                            <p className="truncate font-bold text-[11px] flex items-center gap-1">
                              <span>Pág {pGroup.pageNumber}</span>
                              {hasAudio && (
                                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                                  Áudio IA
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[9px] opacity-75">
                              {hasAudio
                                ? `Pronto · ${(pageScene?.audioDuration || pGroup.duration).toFixed(1)}s`
                                : hasText
                                ? 'Texto pronto (Sem áudio IA)'
                                : 'Sem narração'}
                            </p>
                          </div>
                        </div>

                        {!hasAudio && hasText && onGoToNarracao && (
                          <button
                            type="button"
                            onClick={onGoToNarracao}
                            className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors font-semibold cursor-pointer"
                            title="Ir para a aba de Narração para gerar o áudio"
                          >
                            Gerar
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* TRACK 3: Transições */}
            <div className="mb-2 flex items-center gap-2">
              <div className="flex w-20 shrink-0 items-center gap-1 text-[11px] text-muted-foreground select-none">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                <span className="truncate font-semibold">Transição</span>
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background/60 p-1.5 border border-border/50">
                {frames.map((frame, i) => {
                  const trans = frame.transition;
                  const label =
                    trans === 'zoom_in'
                      ? 'Zoom In'
                      : trans === 'zoom_out'
                      ? 'Zoom Out'
                      : trans === 'fade'
                      ? 'Fade'
                      : trans === 'pan_down'
                      ? 'Pan Vert.'
                      : trans === 'cut'
                      ? 'Corte Seco'
                      : selectedTransition;
                  return (
                    <div
                      key={frame.id || i}
                      className="grid h-7 shrink-0 place-items-center rounded border border-purple-500/30 bg-purple-500/10 px-2 text-[9px] font-semibold text-purple-300"
                      style={{ width: `${Math.max(50, (frame.duration || 4) * pixelsPerSecond)}px` }}
                      title={`Transição: ${label}`}
                    >
                      <span className="truncate">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Red Draggable Playhead Needle */}
            <div
              className="absolute top-1 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none transition-none"
              style={{
                left: `${88 + currentTime * pixelsPerSecond}px`,
              }}
            >
              {/* Playhead Grab Handle Pill at Top */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsScrubbing(true);
                }}
                className="pointer-events-auto absolute -top-4 -left-7 px-2 py-0.5 rounded-full bg-red-500 text-white font-mono text-[9px] font-bold shadow-xl cursor-ew-resize flex items-center gap-0.5 select-none hover:scale-110 active:scale-110 active:cursor-grabbing transition-transform"
                title="Clique e arraste a playhead para navegar no tempo"
              >
                <span>{formatTime(currentTime)}</span>
              </div>

              {/* Triangle Indicator Pointing Down */}
              <div className="absolute top-1 -left-[5px] w-0 h-0 border-x-[6px] border-x-transparent border-t-[8px] border-t-red-500 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
