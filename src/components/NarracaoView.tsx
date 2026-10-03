import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Sparkles,
  Layers,
  Trash2,
  X,
  Clock,
  Check,
  Film,
  Settings,
  Copy,
  Eye,
  AlertCircle,
  CheckCircle2,
  Scissors,
  FileText,
  BookOpen,
  ArrowRight,
  Zap,
  Sliders,
  Monitor,
  Smartphone,
  Video,
  ExternalLink,
  ChevronRight,
  Maximize2,
  MoveHorizontal,
  Wand2,
  Mic,
  Music,
  Loader2,
} from 'lucide-react';
import {
  ChapterItem,
  FrameItem,
  SceneItem,
  TransitionType,
  TRANSITION_OPTIONS,
} from '../types';
import {
  AiNarrationConfig,
  AVAILABLE_MODELS,
  AVAILABLE_TTS_MODELS,
  DEFAULT_AI_CONFIG,
  NARRATION_PROFILES,
  ChapterPageItem,
  calculateRequiredSpeechDuration,
  estimateNarrationDuration,
  generateChapterNarrationWithVision,
  generatePageNarrationWithVision,
  generate9routerSpeech,
  getAudioBlobDuration,
  calculateWeightedSceneDurations,
  consolidatePageNarrationText,
  loadAiNarrationConfig,
  saveAiNarrationConfig,
  testAiConnection,
} from '../utils/aiNarration';

interface NarracaoViewProps {
  chapters: ChapterItem[];
  allFrames: FrameItem[];
  scenes: SceneItem[];
  onUpdateScene: (scene: SceneItem) => void;
  onSetScenes?: (scenes: SceneItem[]) => void;
  onAddScene?: () => void;
  onDeleteScene?: (sceneId: string) => void;
  onRemoveFrame?: (frameId: string) => void;
  onUpdateFrame?: (frameId: string, partial: Partial<FrameItem>) => void;
  onUpdateMultipleFrames?: (
    updates: { id: string; duration?: number; transition?: TransitionType; narrationSnippet?: string }[]
  ) => void;
  onGoToRecorte?: () => void;
  onGoToMontagem?: () => void;
}

interface PageRowData {
  chapterId: string;
  chapterLabel: string;
  pageNumber: number;
  totalPages: number;
  rawPageUrl: string;
  frames: FrameItem[];
  scene: SceneItem;
}

// 1-Click Toggle Chips configuration
export const MOTION_CHIPS: {
  id: TransitionType;
  label: string;
  icon: string;
  fullLabel: string;
  description: string;
}[] = [
  { id: 'zoom_in', label: 'In', icon: '🔍', fullLabel: 'Zoom Lento In', description: 'Aproximação suave (Ken Burns In)' },
  { id: 'zoom_out', label: 'Out', icon: '🔎', fullLabel: 'Zoom Lento Out', description: 'Afastamento suave (Ken Burns Out)' },
  { id: 'pan_down', label: 'Pan', icon: '↕', fullLabel: 'Pan Vertical', description: 'Deslizamento vertical (Top to Bottom)' },
  { id: 'fade', label: 'Fade', icon: '🌫', fullLabel: 'Fade In/Out', description: 'Transição suave de opacidade' },
  { id: 'cut', label: 'Cut', icon: '✕', fullLabel: 'Corte Seco', description: 'Troca instantânea sem efeito' },
];

/**
 * Extracts or estimates the portion of narration text belonging to a specific cropped frame.
 */
export function getFrameNarrationText(
  frame: FrameItem,
  allPageFrames: FrameItem[],
  fullPageText: string
): string {
  if (frame.narrationSnippet && frame.narrationSnippet.trim()) {
    return frame.narrationSnippet.trim();
  }
  if (!fullPageText || !fullPageText.trim()) return '';

  const sentences = fullPageText
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) return fullPageText.trim();

  const frameIdx = allPageFrames.findIndex((f) => f.id === frame.id);
  if (frameIdx < 0) return fullPageText.trim();

  if (sentences.length === allPageFrames.length) {
    return sentences[frameIdx];
  }

  const sentencesPerFrame = Math.max(
    1,
    Math.round(sentences.length / Math.max(1, allPageFrames.length))
  );
  const start = frameIdx * sentencesPerFrame;
  const slice = sentences.slice(start, start + sentencesPerFrame);
  return slice.join(' ') || sentences[sentences.length - 1] || fullPageText.trim();
}

/**
 * FrameDurationSlider: Individual linear range slider graduated from 1.0s to 10.0s
 * with instant 60fps responsiveness, visual ticks, high-retention zone indicator (1s–4s),
 * speech requirement synchronization indicator with 1-click snap, and fine-tuning steppers (-0.1s/+0.1s/-0.5s/+0.5s).
 */
interface FrameDurationSliderProps {
  value: number;
  onChange: (newVal: number) => void;
  frameId: string;
  frameText?: string;
}

const FrameDurationSlider: React.FC<FrameDurationSliderProps> = ({
  value,
  onChange,
  frameText,
}) => {
  const [localVal, setLocalVal] = useState<number>(() =>
    Math.min(10.0, Math.max(1.0, Math.round(Number(value || 3.5) * 10) / 10))
  );
  const isDraggingRef = useRef(false);

  // Sync from props only when not dragging to prevent slider jitter
  useEffect(() => {
    if (!isDraggingRef.current) {
      const clamped = Math.min(10.0, Math.max(1.0, Math.round(Number(value || 3.5) * 10) / 10));
      setLocalVal(clamped);
    }
  }, [value]);

  const commitValue = (val: number) => {
    const clamped = Math.min(10.0, Math.max(1.0, Math.round(val * 10) / 10));
    setLocalVal(clamped);
    onChange(clamped);
  };

  const neededSpeechDuration = React.useMemo(() => {
    if (!frameText || !frameText.trim()) return 0;
    return calculateRequiredSpeechDuration(frameText);
  }, [frameText]);

  const isHighRetention = localVal <= 4.0;
  const isSpeechCovered = neededSpeechDuration === 0 || localVal >= neededSpeechDuration;
  const pct = Math.min(100, Math.max(0, ((localVal - 1.0) / 9.0) * 100));

  return (
    <div className="w-full space-y-1 select-none" onClick={(e) => e.stopPropagation()}>
      {/* Top Label & Badge Row */}
      <div className="flex items-center justify-between gap-1 text-[11px]">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-[10px] text-muted-foreground font-semibold">Tempo:</span>
          <span
            className={`font-mono font-bold px-1.5 py-0.2 rounded text-[10.5px] border ${
              isSpeechCovered
                ? isHighRetention
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                : 'bg-rose-500/15 text-rose-300 border-rose-500/30 animate-pulse'
            }`}
          >
            [ {localVal.toFixed(1)}s ]
          </span>

          {/* Speech sync status badge */}
          {neededSpeechDuration > 0 && !isSpeechCovered && (
            <button
              type="button"
              onClick={() => commitValue(neededSpeechDuration)}
              className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-all cursor-pointer shadow-2xs"
              title={`A fala requer ~${neededSpeechDuration.toFixed(1)}s. Clique para sincronizar imediatamente!`}
            >
              <span>⚠️ Fala: {neededSpeechDuration.toFixed(1)}s</span>
              <span className="underline decoration-dotted text-white font-semibold">Ajustar</span>
            </button>
          )}

          {neededSpeechDuration > 0 && isSpeechCovered && (
            <span className="text-[9px] font-medium text-emerald-400/90 hidden sm:inline">
              ✓ Fala sincronizada
            </span>
          )}

          {neededSpeechDuration === 0 && (
            isHighRetention ? (
              <span className="text-[9px] font-semibold text-emerald-400/90 hidden sm:inline">
                ⚡ 1-4s ideal
              </span>
            ) : (
              <span className="text-[9px] font-semibold text-amber-400/90 hidden sm:inline">
                ⚠️ &gt;4s
              </span>
            )
          )}
        </div>

        {/* Quick Stepper Buttons with both 0.1s fine tuning and 0.5s steps */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => commitValue(localVal - 0.1)}
            disabled={localVal <= 1.0}
            className="h-4 px-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground text-[9px] font-mono font-bold flex items-center justify-center border border-border cursor-pointer transition-colors"
            title="Ajuste fino: -0.1s"
          >
            -0.1
          </button>
          <button
            type="button"
            onClick={() => commitValue(localVal + 0.1)}
            disabled={localVal >= 10.0}
            className="h-4 px-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground text-[9px] font-mono font-bold flex items-center justify-center border border-border cursor-pointer transition-colors"
            title="Ajuste fino: +0.1s"
          >
            +0.1
          </button>
          <button
            type="button"
            onClick={() => commitValue(localVal - 0.5)}
            disabled={localVal <= 1.0}
            className="h-4 w-4 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground text-[10px] font-bold flex items-center justify-center border border-border cursor-pointer transition-colors"
            title="Diminuir 0.5s"
          >
            -
          </button>
          <button
            type="button"
            onClick={() => commitValue(localVal + 0.5)}
            disabled={localVal >= 10.0}
            className="h-4 w-4 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground text-[10px] font-bold flex items-center justify-center border border-border cursor-pointer transition-colors"
            title="Aumentar 0.5s"
          >
            +
          </button>
        </div>
      </div>

      {/* Styled Linear Range Slider with dynamic gradient track */}
      <div className="relative pt-0.5">
        <input
          type="range"
          min="1.0"
          max="10.0"
          step="0.1"
          value={localVal}
          onPointerDown={() => {
            isDraggingRef.current = true;
          }}
          onPointerUp={() => {
            isDraggingRef.current = false;
            commitValue(localVal);
          }}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) {
              const clamped = Math.min(10.0, Math.max(1.0, Math.round(v * 10) / 10));
              setLocalVal(clamped);
              commitValue(clamped);
            }
          }}
          style={{
            background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`,
          }}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none transition-all shadow-inner"
        />

        {/* Graduated Linear Ruler with Discrete Clickable Ticks */}
        <div className="flex justify-between items-center px-0.5 text-[8px] font-mono select-none -mt-0.5">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => {
            const isTarget = Math.round(localVal) === num;
            const isSpecial = num === 4;
            const isGood = num <= 4;
            return (
              <button
                key={num}
                type="button"
                onClick={() => commitValue(num)}
                className={`cursor-pointer transition-colors hover:text-primary ${
                  isTarget
                    ? 'text-primary font-extrabold underline'
                    : isSpecial
                    ? 'text-emerald-400 font-bold'
                    : isGood
                    ? 'text-emerald-400/80 font-semibold'
                    : 'text-muted-foreground/60'
                }`}
                title={`Definir para ${num}.0s`}
              >
                {num}s{isSpecial ? '★' : ''}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/**
 * PlayerScrubberBar: Ultra-fluid 60fps timeline scrubber with segmented frame cuts,
 * interactive pointer drag with pointer capture, live hover/drag timestamp tooltip, and thumb knob.
 */
interface PlayerScrubberBarProps {
  currentTime: number;
  totalDuration: number;
  frames: FrameItem[];
  onSeek: (time: number) => void;
}

const PlayerScrubberBar: React.FC<PlayerScrubberBarProps> = ({
  currentTime,
  totalDuration,
  frames,
  onSeek,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPosPct, setHoverPosPct] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Compute frame marker cut points across totalDuration
  const frameCuts = React.useMemo(() => {
    if (!frames || frames.length <= 1 || totalDuration <= 0) return [];
    let acc = 0;
    const cuts: { pct: number; label: string; time: number }[] = [];
    frames.forEach((f, idx) => {
      if (idx > 0) {
        cuts.push({
          pct: Math.min(100, (acc / totalDuration) * 100),
          label: f.label || `Q${idx + 1}`,
          time: acc,
        });
      }
      acc += (f.duration || 3.5);
    });
    return cuts;
  }, [frames, totalDuration]);

  const updateFromPointer = (clientX: number) => {
    const track = trackRef.current;
    if (!track || totalDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const target = Number((pos * totalDuration).toFixed(2));
    onSeek(target);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    updateFromPointer(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (!track || totalDuration <= 0) return;
    const rect = track.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosPct(pos * 100);
    setHoverTime(Number((pos * totalDuration).toFixed(1)));

    if (isDragging) {
      updateFromPointer(e.clientX);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const progressPct =
    totalDuration > 0 ? Math.min(100, Math.max(0, (currentTime / totalDuration) * 100)) : 0;

  return (
    <div
      ref={trackRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setIsHovering(true)}
      onPointerLeave={() => {
        setIsHovering(false);
        if (!isDragging) setIsDragging(false);
      }}
      className="relative min-w-0 flex-1 cursor-pointer py-2 group select-none touch-none"
      title="Arraste para navegar fluidamente no tempo"
    >
      {/* Floating Hover / Drag Tooltip */}
      {(isHovering || isDragging) && (
        <div
          className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/95 text-white font-mono text-[10px] font-bold pointer-events-none shadow-md z-30 flex items-center gap-1 border border-white/20 whitespace-nowrap"
          style={{ left: `${isDragging ? progressPct : hoverPosPct}%` }}
        >
          <span>{(isDragging ? currentTime : hoverTime).toFixed(1)}s</span>
        </div>
      )}

      {/* Main Track Background */}
      <div className="h-2 w-full rounded-full bg-muted/60 relative overflow-hidden transition-all group-hover:h-2.5">
        {/* Visual Frame Cut Divider Lines */}
        {frameCuts.map((cut, cIdx) => (
          <div
            key={cIdx}
            className="absolute top-0 bottom-0 w-[1.5px] bg-background/90 z-10 pointer-events-none"
            style={{ left: `${cut.pct}%` }}
          />
        ))}

        {/* Filled Progress Bar (instant 60fps tracking without transition delay) */}
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${progressPct}%`,
          }}
        />
      </div>

      {/* Scrubber Thumb Knob */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full bg-white border-2 border-primary shadow-md pointer-events-none transition-transform group-hover:scale-125"
        style={{ left: `${progressPct}%` }}
      />
    </div>
  );
};

export const NarracaoView: React.FC<NarracaoViewProps> = ({
  chapters,
  allFrames,
  scenes,
  onUpdateScene,
  onSetScenes,
  onRemoveFrame,
  onUpdateFrame,
  onUpdateMultipleFrames,
  onGoToRecorte,
  onGoToMontagem,
}) => {
  // AI Configuration state
  const [aiConfig, setAiConfig] = useState<AiNarrationConfig>(() => loadAiNarrationConfig());
  const [isConfigModalOpen, setIsConfigModalOpen] = useState<boolean>(false);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Selected Narration Profile ('sarcastico', 'epico', 'tatico', 'dinamico')
  const [selectedProfileId, setSelectedProfileId] = useState<string>(
    () => aiConfig.stylePreset || 'sarcastico'
  );

  // Chapter dramatic arc summary
  const [chapterSummary, setChapterSummary] = useState<{
    chapterLabel: string;
    text: string;
  } | null>(null);

  // Selected chapter filter in Narração view
  const [activeChapterId, setActiveChapterId] = useState<string>('all');

  // Generation status tracking per scene ID
  const [generatingSceneIds, setGeneratingSceneIds] = useState<Record<string, boolean>>({});
  const [sceneErrors, setSceneErrors] = useState<Record<string, string>>({});

  // Batch generation status
  const [isBatchGenerating, setIsBatchGenerating] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    stage: string;
    current: number;
    total: number;
  }>({ stage: '', current: 0, total: 0 });

  // TTS audio playback for individual row
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  const [isPageTtsPaused, setIsPageTtsPaused] = useState<boolean>(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');

  // 9router Consolidated Master Neural Audio per page
  const [pageAudioMap, setPageAudioMap] = useState<
    Record<
      number,
      {
        audioUrl: string;
        blob: Blob;
        duration: number;
        generatedAt: number;
      }
    >
  >({});
  const [generatingAudioPages, setGeneratingAudioPages] = useState<Record<number, boolean>>({});
  const [isBatchGeneratingAudio, setIsBatchGeneratingAudio] = useState<boolean>(false);
  const [playingAudioPage, setPlayingAudioPage] = useState<number | null>(null);
  const masterAudioRef = useRef<HTMLAudioElement | null>(null);

  // Initialize master audio element for neural playback
  useEffect(() => {
    const audio = new Audio();
    masterAudioRef.current = audio;

    const handleEnded = () => {
      setIsPlayingPreview(false);
      setPlayingAudioPage(null);
      setPreviewCurrentTime(0);
    };

    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audio.src = '';
    };
  }, []);

  // Synchronize existing scenes audio into pageAudioMap on mount and when scenes update
  useEffect(() => {
    setPageAudioMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const scene of scenes) {
        if (scene.pageNumber && scene.audioUrl && (!next[scene.pageNumber] || next[scene.pageNumber].audioUrl !== scene.audioUrl)) {
          next[scene.pageNumber] = {
            audioUrl: scene.audioUrl,
            blob: new Blob([]),
            duration: scene.audioDuration || 3.5,
            generatedAt: Date.now(),
          };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [scenes]);

  // Image preview modal
  const [previewImageUrl, setPreviewImageUrl] = useState<{
    title: string;
    url: string;
  } | null>(null);

  // Toast / feedback message
  const [toastMessage, setToastMessage] = useState<{
    text: string;
    type: 'success' | 'info' | 'error';
  } | null>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((curr) => (curr?.text === text ? null : curr));
    }, 4000);
  };

  // Load available browser voices for TTS
  useEffect(() => {
    const updateVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        setAvailableVoices(voices);
        const pt = voices.find((v) => v.lang.startsWith('pt'));
        if (pt && !selectedVoiceURI) {
          setSelectedVoiceURI(pt.voiceURI);
        }
      }
    };
    updateVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, [selectedVoiceURI]);

  // Save config changes to localStorage
  const handleSaveConfig = (newConfig: AiNarrationConfig) => {
    setAiConfig(newConfig);
    saveAiNarrationConfig(newConfig);
    showToast('Configurações da IA salvas com sucesso!');
  };

  // Test 9router connection
  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setConnectionTestResult(null);
    try {
      const result = await testAiConnection(aiConfig);
      setConnectionTestResult(result);
    } catch (err: any) {
      setConnectionTestResult({
        success: false,
        message: err?.message || 'Falha ao testar conexão',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // 1. Identify chapters that have cropped frames in chronological order
  const chapterOrderMap = new Map(chapters.map((ch, idx) => [ch.id, idx]));
  const chaptersWithCuts = chapters
    .filter((ch) => allFrames.some((f) => f.chapterId === ch.id))
    .sort((a, b) => {
      const idxA = chapterOrderMap.get(a.id) ?? 0;
      const idxB = chapterOrderMap.get(b.id) ?? 0;
      return idxA - idxB;
    });

  // Ensure activeChapterId is valid
  useEffect(() => {
    if (activeChapterId !== 'all') {
      const exists = chaptersWithCuts.some((c) => c.id === activeChapterId);
      if (!exists && chaptersWithCuts.length > 0) {
        setActiveChapterId('all');
      }
    }
  }, [chaptersWithCuts, activeChapterId]);

  // 2. Build rows: Each row is a Page that has cropped frames!
  const targetChapters =
    activeChapterId === 'all'
      ? chaptersWithCuts
      : chaptersWithCuts.filter((c) => c.id === activeChapterId);

  const pageRows: PageRowData[] = [];

  for (const ch of targetChapters) {
    const pagesWithCuts = Array.from(
      new Set(
        allFrames
          .filter((f) => f.chapterId === ch.id && f.pageNumber)
          .map((f) => f.pageNumber!)
      )
    ).sort((a, b) => a - b);

    for (const pNum of pagesWithCuts) {
      const pageFrames = allFrames
        .filter((f) => f.chapterId === ch.id && f.pageNumber === pNum)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));

      // Raw page image URL from chapter imageUrls
      const rawPageUrl =
        (ch.imageUrls && ch.imageUrls[pNum - 1]) ||
        pageFrames[0]?.src ||
        '';

      // Find or build corresponding scene
      const sceneId = `scene_${ch.id}_p${pNum}`;
      let scene = scenes.find(
        (s) => (s.chapterId === ch.id && s.pageNumber === pNum) || s.id === sceneId
      );

      if (!scene) {
        scene = {
          id: sceneId,
          title: `${ch.label} · Página ${String(pNum).padStart(2, '0')}`,
          chapterId: ch.id,
          pageNumber: pNum,
          rawPageUrl: rawPageUrl,
          frames: pageFrames,
          voice: 'Rafael (grave)',
          duration: '0:00',
          text: '',
          status: 'idle',
        };
      } else {
        if (scene.frames.length !== pageFrames.length || scene.rawPageUrl !== rawPageUrl) {
          scene = {
            ...scene,
            frames: pageFrames,
            rawPageUrl: rawPageUrl || scene.rawPageUrl,
          };
        }
      }

      pageRows.push({
        chapterId: ch.id,
        chapterLabel: ch.label,
        pageNumber: pNum,
        totalPages: ch.pages || pagesWithCuts.length,
        rawPageUrl,
        frames: pageFrames,
        scene,
      });
    }
  }

  // Ensure rows are strictly in chapter order and ascending page order
  pageRows.sort((a, b) => {
    const chA = chapterOrderMap.get(a.chapterId) ?? 0;
    const chB = chapterOrderMap.get(b.chapterId) ?? 0;
    if (chA !== chB) return chA - chB;
    return a.pageNumber - b.pageNumber;
  });

  // Synchronize generated/discovered scenes back to App scenes state
  useEffect(() => {
    if (pageRows.length === 0) return;

    let hasDiff = false;
    const currentSceneMap = new Map(scenes.map((s) => [s.id, s]));

    const mergedScenes = [...scenes];

    for (const row of pageRows) {
      const existing = currentSceneMap.get(row.scene.id);
      if (!existing) {
        mergedScenes.push(row.scene);
        hasDiff = true;
      } else if (
        existing.frames.length !== row.frames.length ||
        existing.rawPageUrl !== row.rawPageUrl
      ) {
        const idx = mergedScenes.findIndex((s) => s.id === row.scene.id);
        if (idx !== -1) {
          mergedScenes[idx] = {
            ...mergedScenes[idx],
            frames: row.frames,
            rawPageUrl: row.rawPageUrl,
          };
          hasDiff = true;
        }
      }
    }

    if (hasDiff && onSetScenes) {
      onSetScenes(mergedScenes);
    }
  }, [pageRows.length, allFrames.length]);

  // Overall Statistics
  const totalRecapWords = pageRows.reduce((sum, r) => {
    const dur = estimateNarrationDuration(r.scene.text);
    return sum + dur.wordCount;
  }, 0);

  const totalEstimatedSeconds = pageRows.reduce((sum, r) => {
    const dur = estimateNarrationDuration(r.scene.text);
    return sum + dur.seconds;
  }, 0);

  const formattedTotalTime = `${Math.floor(totalEstimatedSeconds / 60)}m ${String(
    totalEstimatedSeconds % 60
  ).padStart(2, '0')}s`;

  // Total duration of all frame scenes across the targeted chapter pages
  const totalChapterFramesDuration = pageRows.reduce((sum, r) => {
    return sum + r.frames.reduce((fSum, f) => fSum + (f.duration || 3.5), 0);
  }, 0);

  // ==========================================
  // RIGHT COLUMN: REAL-TIME PREVIEW PLAYER ENGINE
  // ==========================================
  const [activePageNumber, setActivePageNumber] = useState<number>(() => {
    return pageRows[0]?.pageNumber || 1;
  });

  useEffect(() => {
    if (pageRows.length > 0) {
      const exists = pageRows.some((r) => r.pageNumber === activePageNumber);
      if (!exists) {
        setActivePageNumber(pageRows[0].pageNumber);
      }
    }
  }, [pageRows, activePageNumber]);

  const [previewAspect, setPreviewAspect] = useState<'16:9' | '9:16'>('16:9');
  const [previewScope, setPreviewScope] = useState<'page' | 'chapter'>('page');
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(false);
  const [previewCurrentTime, setPreviewCurrentTime] = useState<number>(0);
  const [enablePreviewTts, setEnablePreviewTts] = useState<boolean>(true);
  const lastSpokenFrameIdRef = useRef<string | null>(null);
  const isTtsPausedRef = useRef<boolean>(false);
  const isSpeechSpeakingRef = useRef<boolean>(false);
  const speechHoldTimeoutRef = useRef<number>(0);

  const activeRow =
    pageRows.find((r) => r.pageNumber === activePageNumber) || pageRows[0] || null;

  const activePreviewFrames: FrameItem[] = React.useMemo(() => {
    if (previewScope === 'page') {
      return activeRow ? activeRow.frames : [];
    }
    return pageRows.flatMap((r) => r.frames);
  }, [previewScope, activeRow, pageRows]);

  const previewTotalDuration = React.useMemo(() => {
    if (activePreviewFrames.length === 0) return 0.5;
    return activePreviewFrames.reduce((acc, f) => acc + (f.duration || 3.5), 0);
  }, [activePreviewFrames]);

  // Sync master audio src when page or its audio changes
  useEffect(() => {
    const pageAudio = pageAudioMap[activePageNumber] || (activeRow?.scene.audioUrl ? { audioUrl: activeRow.scene.audioUrl, duration: activeRow.scene.audioDuration || 0 } : null);
    const audio = masterAudioRef.current;
    if (audio) {
      if (pageAudio && pageAudio.audioUrl) {
        if (audio.src !== pageAudio.audioUrl) {
          audio.src = pageAudio.audioUrl;
          audio.currentTime = 0;
        }
      } else {
        if (!isPlayingPreview) {
          audio.pause();
          audio.src = '';
        }
      }
    }
  }, [activePageNumber, pageAudioMap, activeRow?.scene.audioUrl, isPlayingPreview]);

  // Reset preview time ONLY when the preview scope changes ('page' vs 'chapter'),
  // NEVER on activePageNumber change or frame clicks so playback position is preserved!
  useEffect(() => {
    setPreviewCurrentTime(0);
    setIsPlayingPreview(false);
    if (masterAudioRef.current) {
      masterAudioRef.current.pause();
      masterAudioRef.current.currentTime = 0;
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    isTtsPausedRef.current = false;
    lastSpokenFrameIdRef.current = null;
    isSpeechSpeakingRef.current = false;
  }, [previewScope]);

  // Smooth animation playback loop with exact 9router master neural audio synchronization
  useEffect(() => {
    let interval: any = null;
    const audio = masterAudioRef.current;
    const pageAudio = pageAudioMap[activePageNumber] || (activeRow?.scene.audioUrl ? { audioUrl: activeRow.scene.audioUrl, duration: activeRow.scene.audioDuration || 0 } : null);

    if (isPlayingPreview) {
      interval = setInterval(() => {
        // If master audio is loaded and playing, sync previewCurrentTime directly from audio.currentTime
        if (pageAudio && audio && !audio.paused) {
          const cur = audio.currentTime;
          const maxDur = pageAudio.duration || audio.duration || previewTotalDuration;
          if (audio.ended || cur >= maxDur) {
            setIsPlayingPreview(false);
            setPreviewCurrentTime(0);
            return;
          }
          setPreviewCurrentTime(Number(cur.toFixed(2)));
          return;
        }

        // Fallback timer when no master audio is loaded for this page
        setPreviewCurrentTime((t) => {
          if (t >= previewTotalDuration) {
            setIsPlayingPreview(false);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            isTtsPausedRef.current = false;
            lastSpokenFrameIdRef.current = null;
            isSpeechSpeakingRef.current = false;
            return 0;
          }

          // If TTS is active, prevent premature visual cut if Web Speech API is still speaking the current frame
          if (
            enablePreviewTts &&
            (!pageAudio || !pageAudio.audioUrl) &&
            isSpeechSpeakingRef.current &&
            'speechSynthesis' in window &&
            window.speechSynthesis.speaking
          ) {
            // Find current frame's end time
            let acc = 0;
            let curFrameEnd = previewTotalDuration;
            for (let i = 0; i < activePreviewFrames.length; i++) {
              const dur = activePreviewFrames[i].duration || 3.5;
              if (t < acc + dur || i === activePreviewFrames.length - 1) {
                curFrameEnd = acc + dur;
                break;
              }
              acc += dur;
            }

            if (t + 0.06 >= curFrameEnd) {
              speechHoldTimeoutRef.current += 35;
              if (speechHoldTimeoutRef.current < 3500) {
                return Number((curFrameEnd - 0.02).toFixed(2));
              }
              speechHoldTimeoutRef.current = 0;
              isSpeechSpeakingRef.current = false;
            }
          } else {
            speechHoldTimeoutRef.current = 0;
          }

          return Number((t + 0.04).toFixed(2));
        });
      }, 35);
    } else {
      if (audio && !audio.paused) {
        audio.pause();
      }
    }

    return () => clearInterval(interval);
  }, [isPlayingPreview, previewTotalDuration, enablePreviewTts, activePreviewFrames, pageAudioMap, activePageNumber, activeRow?.scene.audioUrl, activeRow?.scene.audioDuration]);

  // Find active preview frame and animation progress
  const currentPreviewState = React.useMemo(() => {
    if (activePreviewFrames.length === 0) {
      return {
        frame: null,
        frameIndex: -1,
        progress: 0,
        sceneText: activeRow?.scene.text || '',
        pageNumber: activePageNumber,
      };
    }

    let acc = 0;
    let foundIndex = 0;
    let frameStart = 0;
    let frameDur = activePreviewFrames[0].duration || 3.5;

    for (let i = 0; i < activePreviewFrames.length; i++) {
      const f = activePreviewFrames[i];
      const dur = f.duration || 3.5;
      if (previewCurrentTime < acc + dur || i === activePreviewFrames.length - 1) {
        foundIndex = i;
        frameStart = acc;
        frameDur = dur;
        break;
      }
      acc += dur;
    }

    const curFrame = activePreviewFrames[foundIndex];
    const frameElapsed = Math.max(0, previewCurrentTime - frameStart);
    const progress = Math.min(1, frameDur > 0 ? frameElapsed / frameDur : 0);

    const currentFramePage = curFrame.pageNumber || activePageNumber;
    const curRow = pageRows.find((r) => r.pageNumber === currentFramePage) || activeRow;
    const sceneText = curRow ? curRow.scene.text : '';

    return {
      frame: curFrame,
      frameIndex: foundIndex,
      progress,
      sceneText,
      pageNumber: currentFramePage,
    };
  }, [activePreviewFrames, previewCurrentTime, activeRow, activePageNumber, pageRows]);

  // TTS audio playback in preview: synchronized PER FRAME with pause/resume support
  useEffect(() => {
    const pageAudio = pageAudioMap[activePageNumber] || (activeRow?.scene.audioUrl ? { audioUrl: activeRow.scene.audioUrl } : null);
    if (pageAudio && pageAudio.audioUrl) {
      // Neural audio from API is loaded: cancel any local Web Speech so it doesn't speak over it
      if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    if (!isPlayingPreview) {
      if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        isTtsPausedRef.current = true;
      }
      return;
    }

    if (!enablePreviewTts) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      isTtsPausedRef.current = false;
      lastSpokenFrameIdRef.current = null;
      isSpeechSpeakingRef.current = false;
      return;
    }

    // If resuming from pause on the same frame, resume speech directly without restarting from start
    if (isTtsPausedRef.current && 'speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        isTtsPausedRef.current = false;
        return;
      }
    }

    const currentFrame = currentPreviewState.frame;
    if (currentFrame && currentFrame.id !== lastSpokenFrameIdRef.current) {
      lastSpokenFrameIdRef.current = currentFrame.id;
      isTtsPausedRef.current = false;

      const frameText = getFrameNarrationText(
        currentFrame,
        activePreviewFrames,
        currentPreviewState.sceneText || activeRow?.scene.text || ''
      );

      if (frameText && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(frameText);
        utter.lang = 'pt-BR';
        utter.rate = 1.15;
        const voice =
          availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ||
          availableVoices.find((v) => v.lang.startsWith('pt')) ||
          null;
        if (voice) utter.voice = voice;
        isSpeechSpeakingRef.current = true;
        utter.onend = () => {
          isSpeechSpeakingRef.current = false;
        };
        utter.onerror = () => {
          isSpeechSpeakingRef.current = false;
        };
        window.speechSynthesis.speak(utter);
      }
    }
  }, [
    isPlayingPreview,
    enablePreviewTts,
    currentPreviewState.frame?.id,
    currentPreviewState.sceneText,
    selectedVoiceURI,
    availableVoices,
    activePreviewFrames,
    activeRow?.scene.text,
    activeRow?.scene.audioUrl,
    pageAudioMap,
    activePageNumber,
  ]);

  // Jump to specific frame on click from cards in the left column
  const handleJumpToFrame = (frame: FrameItem, pageNumber: number) => {
    // If in page scope and switching page, set activePageNumber
    if (activePageNumber !== pageNumber) {
      setActivePageNumber(pageNumber);
    }

    const targetRow = pageRows.find((r) => r.pageNumber === pageNumber);
    const framesList =
      previewScope === 'page'
        ? (targetRow?.frames || [])
        : pageRows.flatMap((r) => r.frames);

    let startTime = 0;
    for (const f of framesList) {
      if (f.id === frame.id) break;
      startTime += (f.duration || 3.5);
    }

    const targetTime = Number(startTime.toFixed(2));
    setPreviewCurrentTime(targetTime);
    lastSpokenFrameIdRef.current = frame.id;
    isTtsPausedRef.current = false;

    const pageAudio = pageAudioMap[pageNumber] || (targetRow?.scene.audioUrl ? { audioUrl: targetRow.scene.audioUrl } : null);
    if (masterAudioRef.current && pageAudio) {
      masterAudioRef.current.currentTime = targetTime;
    }

    // If preview TTS is active and player is playing, immediately speak this frame's text
    if (enablePreviewTts && isPlayingPreview && (!pageAudio || !pageAudio.audioUrl) && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const textToSpeak = getFrameNarrationText(frame, framesList, targetRow?.scene.text || '');
      if (textToSpeak) {
        isSpeechSpeakingRef.current = true;
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.lang = 'pt-BR';
        utter.rate = 1.15;
        const voice =
          availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ||
          availableVoices.find((v) => v.lang.startsWith('pt')) ||
          null;
        if (voice) utter.voice = voice;
        utter.onend = () => {
          isSpeechSpeakingRef.current = false;
        };
        utter.onerror = () => {
          isSpeechSpeakingRef.current = false;
        };
        window.speechSynthesis.speak(utter);
      }
    } else if (!isPlayingPreview && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      isSpeechSpeakingRef.current = false;
    }
  };

  // Play / Pause preview toggle with reliable resume
  const handleTogglePlayPausePreview = () => {
    const pageAudio = pageAudioMap[activePageNumber] || (activeRow?.scene.audioUrl ? { audioUrl: activeRow.scene.audioUrl, duration: activeRow.scene.audioDuration || 0 } : null);
    const audio = masterAudioRef.current;

    if (isPlayingPreview) {
      setIsPlayingPreview(false);
      isSpeechSpeakingRef.current = false;
      if (audio && !audio.paused) {
        audio.pause();
      }
      if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        isTtsPausedRef.current = true;
      }
    } else {
      setIsPlayingPreview(true);
      const shouldRestart = previewCurrentTime >= previewTotalDuration - 0.05;

      if (pageAudio && audio && pageAudio.audioUrl) {
        // High fidelity neural audio from the API
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        isSpeechSpeakingRef.current = false;

        if (audio.src !== pageAudio.audioUrl) {
          audio.src = pageAudio.audioUrl;
        }

        if (shouldRestart) {
          setPreviewCurrentTime(0);
          audio.currentTime = 0;
        } else {
          audio.currentTime = previewCurrentTime;
        }

        if (enablePreviewTts) {
          audio.muted = false;
          audio.play().catch((err) => {
            console.warn('Erro ao tocar áudio neural:', err);
          });
        }
      } else {
        // Fallback to local browser voice if no neural audio generated yet
        if (shouldRestart) {
          setPreviewCurrentTime(0);
          lastSpokenFrameIdRef.current = null;
          isTtsPausedRef.current = false;
          isSpeechSpeakingRef.current = false;
        } else if (isTtsPausedRef.current && enablePreviewTts && 'speechSynthesis' in window) {
          if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
            isTtsPausedRef.current = false;
          }
        }
      }
    }
  };

  // Real-time animation calculation for CSS transform/opacity
  const getTransitionStyle = (
    transition: TransitionType = 'cut',
    progress: number
  ): React.CSSProperties => {
    switch (transition) {
      case 'zoom_in': {
        const scale = 1 + 0.16 * progress;
        return {
          transform: `scale(${scale})`,
          transition: 'transform 60ms linear',
        };
      }
      case 'zoom_out': {
        const scale = 1.16 - 0.16 * progress;
        return {
          transform: `scale(${scale})`,
          transition: 'transform 60ms linear',
        };
      }
      case 'pan_down': {
        const translateY = -5 + 10 * progress;
        return {
          transform: `scale(1.1) translateY(${translateY}%)`,
          transition: 'transform 60ms linear',
        };
      }
      case 'fade': {
        const opacity = progress < 0.25 ? progress / 0.25 : 1;
        return {
          opacity,
          transition: 'opacity 60ms linear',
        };
      }
      case 'cut':
      default:
        return {
          transform: 'scale(1)',
          opacity: 1,
        };
    }
  };

  // Change frame motion transition preset with 1-click toggle
  const handleTransitionChange = (frameId: string, transition: TransitionType) => {
    if (onUpdateFrame) {
      onUpdateFrame(frameId, { transition });
      const chip = MOTION_CHIPS.find((c) => c.id === transition);
      showToast(`Efeito "${chip?.fullLabel || transition}" ativado!`, 'info');
    }
  };

  // Automatic Proportional Distribution based on speech duration of each frame's narration
  const handleAutoDistributePageDurations = (row: PageRowData) => {
    if (row.frames.length === 0) return;

    const updates = row.frames.map((f) => {
      const frameText = getFrameNarrationText(f, row.frames, row.scene.text);
      const neededSec = calculateRequiredSpeechDuration(frameText);
      return {
        id: f.id,
        duration: neededSec,
      };
    });

    if (onUpdateMultipleFrames) {
      onUpdateMultipleFrames(updates);
    } else if (onUpdateFrame) {
      updates.forEach((u) => onUpdateFrame(u.id, { duration: u.duration }));
    }

    const totalCalculated = updates.reduce((acc, u) => acc + u.duration, 0);
    showToast(
      `Duração recalculada e sincronizada com a fala da narração (${totalCalculated.toFixed(1)}s total)!`,
      'success'
    );
  };

  // 1-Touch Batch Automation: Alternate Ken Burns (In on odd, Out on even) for the active page
  const handleAlternateKenBurns = (row: PageRowData) => {
    if (row.frames.length === 0) return;
    const updates = row.frames.map((f, idx) => ({
      id: f.id,
      transition: (idx % 2 === 0 ? 'zoom_in' : 'zoom_out') as TransitionType,
    }));

    if (onUpdateMultipleFrames) {
      onUpdateMultipleFrames(updates);
    } else if (onUpdateFrame) {
      updates.forEach((u) => onUpdateFrame(u.id, { transition: u.transition }));
    }

    showToast(
      `Ken Burns alternado (In/Out) aplicado nas ${row.frames.length} cenas da Página ${row.pageNumber}!`,
      'success'
    );
  };

  // 1-Touch Global Batch Automation: Apply Standard to ALL Pages of Chapter (Time by speech + Alternating Ken Burns)
  const handleApplyStandardToAllPages = () => {
    if (pageRows.length === 0) return;

    const allUpdates: { id: string; duration?: number; transition?: TransitionType }[] = [];

    for (const row of pageRows) {
      if (row.frames.length === 0) continue;

      row.frames.forEach((f, idx) => {
        const frameText = getFrameNarrationText(f, row.frames, row.scene.text);
        const neededSec = calculateRequiredSpeechDuration(frameText);
        allUpdates.push({
          id: f.id,
          duration: neededSec,
          transition: (idx % 2 === 0 ? 'zoom_in' : 'zoom_out') as TransitionType,
        });
      });
    }

    if (onUpdateMultipleFrames) {
      onUpdateMultipleFrames(allUpdates);
    } else if (onUpdateFrame) {
      allUpdates.forEach((u) => onUpdateFrame(u.id, u));
    }

    showToast(
      `Padrão completo (tempo sincronizado por fala + Ken Burns alternado) aplicado a todas as ${pageRows.length} páginas e ${allUpdates.length} cenas!`,
      'success'
    );
  };

  // TTS audio playback for individual scene with pause/resume support & neural audio priority
  const handleTogglePlayTts = (scene: SceneItem) => {
    const pageNum = scene.pageNumber || activePageNumber;
    const pageAudio = pageAudioMap[pageNum] || (scene.audioUrl ? { audioUrl: scene.audioUrl } : null);
    const audio = masterAudioRef.current;

    // If neural audio from API is available, play it directly!
    if (pageAudio && pageAudio.audioUrl && audio) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();

      if (playingSceneId === scene.id && !audio.paused) {
        audio.pause();
        setPlayingSceneId(null);
        setPlayingAudioPage(null);
      } else {
        if (audio.src !== pageAudio.audioUrl) {
          audio.src = pageAudio.audioUrl;
        }
        audio.currentTime = 0;
        audio.play().then(() => {
          setPlayingSceneId(scene.id);
          setPlayingAudioPage(pageNum);
        }).catch((err) => {
          console.warn('Erro ao tocar áudio neural da API:', err);
        });
      }
      return;
    }

    // Fallback: Web Speech API
    if (!('speechSynthesis' in window)) {
      showToast('Seu navegador não suporta síntese de voz (TTS).', 'error');
      return;
    }

    if (playingSceneId === scene.id) {
      if (!isPageTtsPaused && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        setIsPageTtsPaused(true);
        return;
      } else if (isPageTtsPaused && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
        setIsPageTtsPaused(false);
        return;
      } else {
        window.speechSynthesis.cancel();
        setPlayingSceneId(null);
        setIsPageTtsPaused(false);
        return;
      }
    }

    if (!scene.text.trim()) {
      showToast('Nenhum texto de narração para reproduzir nesta página.', 'info');
      return;
    }

    window.speechSynthesis.cancel();
    setIsPageTtsPaused(false);
    const utterance = new SpeechSynthesisUtterance(scene.text);
    const voice =
      availableVoices.find((v) => v.voiceURI === selectedVoiceURI) ||
      availableVoices.find((v) => v.lang.startsWith('pt')) ||
      null;

    if (voice) utterance.voice = voice;
    utterance.lang = 'pt-BR';
    utterance.rate = 1.15;

    utterance.onend = () => {
      setPlayingSceneId(null);
      setIsPageTtsPaused(false);
    };
    utterance.onerror = () => {
      setPlayingSceneId(null);
      setIsPageTtsPaused(false);
    };

    window.speechSynthesis.speak(utterance);
    setPlayingSceneId(scene.id);
  };

  // Generate neural audio via API for a single page row
  const handleGeneratePageAudio = async (row: PageRowData) => {
    const pageNum = row.pageNumber;
    const currentScene = scenes.find((s) => s.id === row.scene.id) || row.scene;
    const text = (currentScene.text || row.scene.text || '').trim();

    if (!text) {
      showToast(`A página ${pageNum} não possui texto de roteiro para gerar áudio.`, 'info');
      return;
    }

    setGeneratingAudioPages((prev) => ({ ...prev, [pageNum]: true }));
    try {
      showToast(`Gerando áudio neural via API para a Página ${String(pageNum).padStart(2, '0')}...`, 'info');
      const speechRes = await generate9routerSpeech({
        text,
        config: aiConfig,
        model: aiConfig.ttsModel,
      });

      setPageAudioMap((prev) => ({
        ...prev,
        [pageNum]: {
          audioUrl: speechRes.audioUrl,
          blob: speechRes.blob,
          duration: speechRes.duration,
          generatedAt: Date.now(),
        },
      }));

      // Synchronize frame durations proportionally
      if (row.frames.length > 0) {
        const weighted = calculateWeightedSceneDurations(row.frames, speechRes.duration, text);
        if (weighted.length > 0) {
          if (onUpdateMultipleFrames) {
            onUpdateMultipleFrames(weighted);
          } else if (onUpdateFrame) {
            weighted.forEach((w) => onUpdateFrame(w.id, { duration: w.duration }));
          }
        }
      }

      // Update SceneItem with audio info
      const updatedScene: SceneItem = {
        ...currentScene,
        audioUrl: speechRes.audioUrl,
        audioBlob: speechRes.blob,
        audioDuration: speechRes.duration,
        voice: aiConfig.ttsModel || currentScene.voice,
      };
      onUpdateScene(updatedScene);

      // If currently previewing this page, update masterAudio
      if (activePageNumber === pageNum && masterAudioRef.current) {
        masterAudioRef.current.src = speechRes.audioUrl;
        masterAudioRef.current.currentTime = 0;
      }

      showToast(`Áudio neural gerado para a Página ${String(pageNum).padStart(2, '0')} (${speechRes.duration.toFixed(1)}s)!`, 'success');
    } catch (err: any) {
      console.error('Erro ao gerar áudio da página:', err);
      showToast(`Erro no TTS da API: ${err?.message || 'Falha na requisição'}`, 'error');
    } finally {
      setGeneratingAudioPages((prev) => ({ ...prev, [pageNum]: false }));
    }
  };

  // Generate neural audio via API for ALL pages in batch
  const handleBatchGenerateAudioAll = async () => {
    if (pageRows.length === 0 || isBatchGeneratingAudio) return;

    setIsBatchGeneratingAudio(true);
    let successCount = 0;
    showToast(`Iniciando geração de áudio neural para ${pageRows.length} página(s)...`, 'info');

    try {
      for (let i = 0; i < pageRows.length; i++) {
        const row = pageRows[i];
        const scene = scenes.find((s) => s.id === row.scene.id) || row.scene;
        const text = scene.text?.trim();

        if (!text) continue;

        setBatchProgress({
          stage: `Gerando áudio neural da Pág ${row.pageNumber} (${i + 1}/${pageRows.length})...`,
          current: i + 1,
          total: pageRows.length,
        });

        try {
          const res = await generate9routerSpeech({
            text,
            config: aiConfig,
            model: aiConfig.ttsModel,
          });

          setPageAudioMap((prev) => ({
            ...prev,
            [row.pageNumber]: {
              audioUrl: res.audioUrl,
              blob: res.blob,
              duration: res.duration,
              generatedAt: Date.now(),
            },
          }));

          if (row.frames.length > 0) {
            const weighted = calculateWeightedSceneDurations(row.frames, res.duration, text);
            if (weighted.length > 0) {
              if (onUpdateMultipleFrames) {
                onUpdateMultipleFrames(weighted);
              } else if (onUpdateFrame) {
                weighted.forEach((w) => onUpdateFrame(w.id, { duration: w.duration }));
              }
            }
          }

          const updatedScene: SceneItem = {
            ...scene,
            audioUrl: res.audioUrl,
            audioBlob: res.blob,
            audioDuration: res.duration,
            voice: aiConfig.ttsModel || scene.voice,
          };
          onUpdateScene(updatedScene);
          successCount++;
        } catch (pageErr: any) {
          console.warn(`Erro no áudio da página ${row.pageNumber}:`, pageErr);
        }
      }

      showToast(`${successCount} áudio(s) gerado(s) com sucesso via API TTS!`, 'success');
    } catch (err: any) {
      showToast(`Erro na geração de áudios: ${err?.message || 'Falha'}`, 'error');
    } finally {
      setIsBatchGeneratingAudio(false);
    }
  };

  // Generate narration with Vision AI for a single page row
  const handleGeneratePageNarration = async (row: PageRowData) => {
    if (!row.rawPageUrl) {
      showToast(`A página ${row.pageNumber} não possui imagem bruta carregada.`, 'error');
      return;
    }

    const sceneId = row.scene.id;
    setGeneratingSceneIds((prev) => ({ ...prev, [sceneId]: true }));
    setSceneErrors((prev) => {
      const next = { ...prev };
      delete next[sceneId];
      return next;
    });

    try {
      const frameLabels = row.frames.map((f) => f.label);
      const prevRowIndex = pageRows.findIndex(
        (r) => r.chapterId === row.chapterId && r.pageNumber === row.pageNumber - 1
      );
      const prevNarration = prevRowIndex >= 0 ? pageRows[prevRowIndex].scene.text : undefined;

      const pageResult = await generatePageNarrationWithVision({
        rawImageUrl: row.rawPageUrl,
        chapterLabel: row.chapterLabel,
        pageNumber: row.pageNumber,
        totalPages: row.totalPages,
        croppedFramesCount: row.frames.length,
        croppedFramesLabels: frameLabels,
        frames: row.frames,
        previousPageNarration: prevNarration,
        config: aiConfig,
        stylePresetId: selectedProfileId,
      });

      // Update frame durations and transitions atomically from AI (SoM anchored)
      if (pageResult.cenas && pageResult.cenas.length > 0 && row.frames.length > 0) {
        const frameUpdates: {
          id: string;
          duration?: number;
          transition?: TransitionType;
          narrationSnippet?: string;
        }[] = [];

        row.frames.forEach((frame, idx) => {
          const cleanFrameLabel = frame.label.toLowerCase().replace(/[\[\]]/g, '').trim();
          const aiScene =
            pageResult.cenas.find((c) => {
              const cleanQuadroId = c.quadro_id.toLowerCase().replace(/[\[\]]/g, '').trim();
              return (
                cleanQuadroId === cleanFrameLabel ||
                cleanQuadroId.includes(cleanFrameLabel) ||
                cleanFrameLabel.includes(cleanQuadroId)
              );
            }) || pageResult.cenas[idx];

          if (aiScene) {
            frameUpdates.push({
              id: frame.id,
              duration: Number(Math.max(1, Math.min(10, aiScene.duracao_segundos)).toFixed(1)),
              transition: aiScene.transicao,
              narrationSnippet: aiScene.roteiro_cena?.trim(),
            });
          }
        });

        if (frameUpdates.length > 0) {
          if (onUpdateMultipleFrames) {
            onUpdateMultipleFrames(frameUpdates);
          } else if (onUpdateFrame) {
            frameUpdates.forEach((u) => onUpdateFrame(u.id, u));
          }
        }
      }

      const scriptText = pageResult.fullScript;
      const durEst = estimateNarrationDuration(scriptText);

      let updatedScene: SceneItem = {
        ...row.scene,
        text: scriptText,
        duration: durEst.formatted,
        status: 'done',
        error: undefined,
      };

      onUpdateScene(updatedScene);
      showToast(
        `Narração atômica da Página ${String(row.pageNumber).padStart(2, '0')} gerada! (${row.frames.length} cenas sincronizadas)`,
        'success'
      );

      // Automatically generate neural TTS audio for this page as well
      try {
        setGeneratingAudioPages((prev) => ({ ...prev, [row.pageNumber]: true }));
        const speechRes = await generate9routerSpeech({
          text: scriptText,
          config: aiConfig,
          model: aiConfig.ttsModel,
        });

        setPageAudioMap((prev) => ({
          ...prev,
          [row.pageNumber]: {
            audioUrl: speechRes.audioUrl,
            blob: speechRes.blob,
            duration: speechRes.duration,
            generatedAt: Date.now(),
          },
        }));

        if (row.frames.length > 0) {
          const weighted = calculateWeightedSceneDurations(row.frames, speechRes.duration, scriptText);
          if (weighted.length > 0) {
            if (onUpdateMultipleFrames) {
              onUpdateMultipleFrames(weighted);
            } else if (onUpdateFrame) {
              weighted.forEach((w) => onUpdateFrame(w.id, { duration: w.duration }));
            }
          }
        }

        updatedScene = {
          ...updatedScene,
          audioUrl: speechRes.audioUrl,
          audioBlob: speechRes.blob,
          audioDuration: speechRes.duration,
          voice: aiConfig.ttsModel || updatedScene.voice,
        };
        onUpdateScene(updatedScene);
      } catch (audioErr: any) {
        console.warn('Aviso: Áudio da página não pôde ser gerado automaticamente:', audioErr);
      } finally {
        setGeneratingAudioPages((prev) => ({ ...prev, [row.pageNumber]: false }));
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Falha ao gerar narração';
      setSceneErrors((prev) => ({ ...prev, [sceneId]: errorMsg }));
      showToast(errorMsg, 'error');
    } finally {
      setGeneratingSceneIds((prev) => ({ ...prev, [sceneId]: false }));
    }
  };

  // Macro vision generation for all pages of the chapter
  const handleBatchGenerateAll = async () => {
    if (pageRows.length === 0) return;
    if (isBatchGenerating) return;

    setIsBatchGenerating(true);
    setChapterSummary(null);

    const chapterGroups: Record<string, PageRowData[]> = {};
    for (const row of pageRows) {
      if (!chapterGroups[row.chapterId]) {
        chapterGroups[row.chapterId] = [];
      }
      chapterGroups[row.chapterId].push(row);
    }

    try {
      const updatedScenesMap = new Map(scenes.map((s) => [s.id, s]));
      const activeProfile =
        NARRATION_PROFILES.find((p) => p.id === selectedProfileId) || NARRATION_PROFILES[0];

      for (const [chId, chRows] of Object.entries(chapterGroups)) {
        const chapterLabel = chRows[0]?.chapterLabel || 'Capítulo';
        setBatchProgress({
          stage: `Preparando ${chRows.length} página(s) de "${chapterLabel}"...`,
          current: 0,
          total: chRows.length,
        });

        const pagesPayload: ChapterPageItem[] = chRows.map((r) => ({
          pageNumber: r.pageNumber,
          rawImageUrl: r.rawPageUrl,
          croppedFramesCount: r.frames.length,
          croppedFramesLabels: r.frames.map((f) => f.label),
          frames: r.frames,
        }));

        const result = await generateChapterNarrationWithVision({
          chapterLabel,
          pages: pagesPayload,
          profileId: selectedProfileId,
          config: aiConfig,
          onProgress: (info) => {
            setBatchProgress({
              stage: info.stage,
              current: info.current || 0,
              total: info.total || chRows.length,
            });
          },
        });

        if (result.resumo_capitulo) {
          setChapterSummary({
            chapterLabel,
            text: result.resumo_capitulo,
          });
        }

        for (const pageResult of result.paginas) {
          const targetRow = chRows.find((r) => r.pageNumber === pageResult.pagina_numero);
          if (targetRow && (pageResult.roteiro || (pageResult.cenas && pageResult.cenas.length > 0))) {
            // Update frame durations and transitions atomically from AI (SoM anchored)
            if (pageResult.cenas && pageResult.cenas.length > 0 && targetRow.frames.length > 0) {
              const frameUpdates: {
                id: string;
                duration?: number;
                transition?: TransitionType;
                narrationSnippet?: string;
              }[] = [];

              targetRow.frames.forEach((frame, idx) => {
                const cleanFrameLabel = frame.label.toLowerCase().replace(/[\[\]]/g, '').trim();
                const aiScene =
                  pageResult.cenas.find((c) => {
                    const cleanQuadroId = c.quadro_id.toLowerCase().replace(/[\[\]]/g, '').trim();
                    return (
                      cleanQuadroId === cleanFrameLabel ||
                      cleanQuadroId.includes(cleanFrameLabel) ||
                      cleanFrameLabel.includes(cleanQuadroId)
                    );
                  }) || pageResult.cenas[idx];

                if (aiScene) {
                  frameUpdates.push({
                    id: frame.id,
                    duration: Number(Math.max(1, Math.min(10, aiScene.duracao_segundos)).toFixed(1)),
                    transition: aiScene.transicao,
                    narrationSnippet: aiScene.roteiro_cena?.trim(),
                  });
                }
              });

              if (frameUpdates.length > 0) {
                if (onUpdateMultipleFrames) {
                  onUpdateMultipleFrames(frameUpdates);
                } else if (onUpdateFrame) {
                  frameUpdates.forEach((u) => onUpdateFrame(u.id, u));
                }
              }
            }

            const scriptText = pageResult.roteiro;
            const durEst = estimateNarrationDuration(scriptText);
            const updatedScene: SceneItem = {
              ...targetRow.scene,
              text: scriptText,
              duration: durEst.formatted,
              status: 'done',
              error: undefined,
            };
            updatedScenesMap.set(updatedScene.id, updatedScene);
            onUpdateScene(updatedScene);
          }
        }

        // Automatically synthesize neural TTS audio for all pages via API
        setBatchProgress({
          stage: 'Sintetizando áudio neural das páginas via API TTS (9router)...',
          current: 0,
          total: chRows.length,
        });

        for (let i = 0; i < chRows.length; i++) {
          const targetRow = chRows[i];
          const scene = updatedScenesMap.get(targetRow.scene.id) || targetRow.scene;
          const text = scene.text?.trim();
          if (text) {
            setBatchProgress({
              stage: `Gerando áudio TTS da página ${targetRow.pageNumber} (${i + 1}/${chRows.length})...`,
              current: i + 1,
              total: chRows.length,
            });
            try {
              const speechRes = await generate9routerSpeech({
                text,
                config: aiConfig,
                model: aiConfig.ttsModel,
              });

              setPageAudioMap((prev) => ({
                ...prev,
                [targetRow.pageNumber]: {
                  audioUrl: speechRes.audioUrl,
                  blob: speechRes.blob,
                  duration: speechRes.duration,
                  generatedAt: Date.now(),
                },
              }));

              if (targetRow.frames.length > 0) {
                const weighted = calculateWeightedSceneDurations(targetRow.frames, speechRes.duration, text);
                if (weighted.length > 0) {
                  if (onUpdateMultipleFrames) {
                    onUpdateMultipleFrames(weighted);
                  } else if (onUpdateFrame) {
                    weighted.forEach((w) => onUpdateFrame(w.id, { duration: w.duration }));
                  }
                }
              }

              const updatedSceneWithAudio: SceneItem = {
                ...scene,
                audioUrl: speechRes.audioUrl,
                audioBlob: speechRes.blob,
                audioDuration: speechRes.duration,
                voice: aiConfig.ttsModel || scene.voice,
              };
              updatedScenesMap.set(updatedSceneWithAudio.id, updatedSceneWithAudio);
              onUpdateScene(updatedSceneWithAudio);
            } catch (audioErr: any) {
              console.warn(`Aviso: Áudio da página ${targetRow.pageNumber} não pôde ser gerado:`, audioErr);
            }
          }
        }
      }

      if (onSetScenes) {
        onSetScenes(Array.from(updatedScenesMap.values()));
      }

      showToast(
        `Roteiro e áudios gerados com sucesso no perfil "${activeProfile.name}"!`,
        'success'
      );
    } catch (err: any) {
      console.error('Erro na geração macro do capítulo:', err);
      showToast(err?.message || 'Falha ao gerar roteiro do capítulo', 'error');
    } finally {
      setIsBatchGenerating(false);
    }
  };

  // Copy text to clipboard
  const handleCopyText = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    showToast('Narração copiada para a área de transferência!');
  };

  // Remove cropped frame from page
  const handleRemoveFrame = (frameId: string, frameLabel: string, pageNumber: number) => {
    if (onRemoveFrame) {
      onRemoveFrame(frameId);
      showToast(`Cena "${frameLabel}" (Pág ${pageNumber}) removida!`, 'info');
    }
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-61px)] bg-background select-none">
      {/* Top Banner & Control Bar */}
      <div className="border-b border-border bg-card/85 backdrop-blur sticky top-0 z-30 px-4 sm:px-6 py-2.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Title & Chapter Navigation */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <span>Narração & Roteiro</span>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                    {totalChapterFramesDuration.toFixed(1)}s total
                  </span>
                </h1>
                <p className="text-[11px] text-muted-foreground hidden sm:block">
                  Régua linear individual (1s a 10s) e controle atômico de tempo por cena.
                </p>
              </div>
            </div>

            {/* Chapter Filter Pill Tabs */}
            {chaptersWithCuts.length > 1 && (
              <div className="flex items-center gap-1 bg-secondary/80 p-0.5 rounded-lg border border-border ml-2">
                <button
                  onClick={() => setActiveChapterId('all')}
                  className={`px-2 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer ${
                    activeChapterId === 'all'
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Todos ({chaptersWithCuts.length})
                </button>
                {chaptersWithCuts.map((ch) => (
                  <button
                    key={ch.id}
                    onClick={() => setActiveChapterId(ch.id)}
                    className={`px-2 py-1 text-xs font-semibold rounded-md transition-all truncate max-w-[130px] cursor-pointer ${
                      activeChapterId === ch.id
                        ? 'bg-primary text-primary-foreground shadow'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title={ch.label}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Quick Actions, 1-Touch Automation, Profile Selector & AI */}
          <div className="flex items-center gap-2">
            {/* Global 1-Touch Automation Button: Apply Standard to All Pages of Chapter */}
            {pageRows.length > 0 && (
              <button
                type="button"
                onClick={handleApplyStandardToAllPages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/15 text-amber-300 hover:bg-amber-500 hover:text-black border border-amber-500/30 text-xs font-bold transition-all shadow-xs cursor-pointer"
                title="Configurar em 1 clique todas as cenas do capítulo: distribui tempos por roteiro (140 pal/min) + alterna Ken Burns (In/Out)"
              >
                <Wand2 className="h-3.5 w-3.5" />
                <span className="hidden md:inline">⚡ Aplicar Padrão a Todo Capítulo</span>
                <span className="md:hidden">⚡ Padrão Capítulo</span>
              </button>
            )}

            {/* AI Config Modal Button */}
            <button
              onClick={() => setIsConfigModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-secondary text-xs font-medium text-foreground transition-colors shadow-xs cursor-pointer"
              title="Configurar endpoint do 9router, chaves e modelos"
            >
              <Settings className="h-3.5 w-3.5 text-primary" />
              <span className="hidden lg:inline">IA & 9router</span>
            </button>

            {/* Selector: Perfil da Narração */}
            <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-xs">
              <label
                htmlFor="narration-profile-select"
                className="text-xs font-semibold text-muted-foreground whitespace-nowrap hidden sm:inline"
              >
                Perfil:
              </label>
              <select
                id="narration-profile-select"
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  const nextConfig = { ...aiConfig, stylePreset: e.target.value };
                  setAiConfig(nextConfig);
                  saveAiNarrationConfig(nextConfig);
                }}
                className="bg-transparent text-xs font-bold text-foreground focus:outline-none cursor-pointer py-0.5"
                title="Escolha o Perfil da Narração para o roteiro completo"
              >
                {NARRATION_PROFILES.map((prof) => (
                  <option
                    key={prof.id}
                    value={prof.id}
                    className="bg-popover text-popover-foreground text-xs"
                  >
                    {prof.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Selector: Voz TTS da API */}
            <div className="hidden sm:flex items-center gap-1.5 bg-card border border-border rounded-lg px-2 py-1 shadow-xs">
              <Mic className="h-3.5 w-3.5 text-primary shrink-0" />
              <select
                value={aiConfig.ttsModel || DEFAULT_AI_CONFIG.ttsModel}
                onChange={(e) => {
                  const nextConfig = { ...aiConfig, ttsModel: e.target.value };
                  setAiConfig(nextConfig);
                  saveAiNarrationConfig(nextConfig);
                }}
                className="bg-transparent text-xs font-bold text-foreground focus:outline-none cursor-pointer py-0.5"
                title="Voz TTS da API (Edge-TTS / 9router)"
              >
                {AVAILABLE_TTS_MODELS.map((v) => (
                  <option
                    key={v.id}
                    value={v.id}
                    className="bg-popover text-popover-foreground text-xs"
                  >
                    {v.name.split(' (')[0]} ({v.badge})
                  </option>
                ))}
              </select>
            </div>

            {/* Batch Generate Text + Audio Button */}
            {pageRows.length > 0 && (
              <button
                onClick={handleBatchGenerateAll}
                disabled={isBatchGenerating || isBatchGeneratingAudio}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shadow disabled:opacity-50 cursor-pointer"
                title={`Gerar roteiro com IA e sintetizar áudios neurais via API para todas as ${pageRows.length} páginas`}
              >
                {isBatchGenerating ? (
                  <>
                    <Zap className="h-3.5 w-3.5 animate-spin" />
                    <span className="truncate max-w-[130px]">Gerando Roteiro...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 fill-current" />
                    <span>⚡ Gerar Todas (Texto + Áudio)</span>
                  </>
                )}
              </button>
            )}

            {/* Batch Generate Only Audio TTS Button */}
            {pageRows.length > 0 && (
              <button
                onClick={handleBatchGenerateAudioAll}
                disabled={isBatchGenerating || isBatchGeneratingAudio}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-secondary text-foreground text-xs font-semibold transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                title="Sintetizar ou regenerar os áudios neurais de todas as páginas usando a API TTS"
              >
                {isBatchGeneratingAudio ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="truncate max-w-[130px]">Gerando Áudios...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-3.5 w-3.5 text-primary" />
                    <span>🎙️ Gerar Áudios TTS</span>
                  </>
                )}
              </button>
            )}

            {/* Jump to Timeline Button */}
            {onGoToMontagem && (
              <button
                onClick={onGoToMontagem}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground text-xs font-semibold transition-all shadow-xs cursor-pointer ml-1"
                title="Ir para a Timeline de Montagem Final"
              >
                <Film className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Montagem</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Batch Progress Bar */}
        {(isBatchGenerating || isBatchGeneratingAudio) && (
          <div className="mt-2.5 pt-2 border-t border-border flex items-center gap-3 animate-fade-in">
            <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width:
                    batchProgress.total > 0 && batchProgress.current > 0
                      ? `${(batchProgress.current / batchProgress.total) * 100}%`
                      : '80%',
                }}
              />
            </div>
            <span className="text-[11px] font-medium text-foreground shrink-0 flex items-center gap-1.5">
              <Zap className="h-3 w-3 animate-spin text-primary" />
              <span>{batchProgress.stage || 'Processando narração do capítulo...'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Main Split Screen Container: 50% Left / 50% Right */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* ========================================================================= */}
        {/* COLUNA ESQUERDA (50%): Mini-Timeline, Controles Rápidos e Roteiro */}
        {/* ========================================================================= */}
        <div className="w-full lg:w-1/2 p-4 sm:p-5 overflow-y-auto space-y-5 lg:border-r border-border min-h-0">
          {/* Chapter Dramatic Arc Summary Banner */}
          {chapterSummary && (
            <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/5 flex items-start justify-between gap-3 animate-fade-in shadow-xs">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">
                      Arco Dramático do {chapterSummary.chapterLabel}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/15 text-primary font-semibold">
                      {NARRATION_PROFILES.find((p) => p.id === selectedProfileId)?.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {chapterSummary.text}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setChapterSummary(null)}
                className="p-1 rounded text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                title="Fechar resumo"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Empty State */}
          {chaptersWithCuts.length === 0 ? (
            <div className="text-center p-12 bg-card rounded-2xl border border-border shadow-xs max-w-lg mx-auto my-8 space-y-4 animate-fade-in">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-inner">
                <Scissors className="h-7 w-7" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Nenhum capítulo com recortes ainda
                </h2>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-sm mx-auto">
                  Faça os recortes dos quadros na tela de <strong>Recortes</strong> para que as páginas apareçam aqui prontas para roteirização e pré-montagem rápida.
                </p>
              </div>
              {onGoToRecorte && (
                <button
                  onClick={onGoToRecorte}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shadow cursor-pointer"
                >
                  <Scissors className="h-4 w-4" />
                  <span>Ir para a Tela de Recortes</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ) : (
            /* Page Cards List */
            <div className="space-y-5">
              {pageRows.map((row) => {
                const isGenerating = !!generatingSceneIds[row.scene.id];
                const isPlaying = playingSceneId === row.scene.id;
                const hasText = row.scene.text.trim().length > 0;
                const durationEst = estimateNarrationDuration(row.scene.text);
                const error = sceneErrors[row.scene.id];
                const isCurrentlyActiveInPreview = activePageNumber === row.pageNumber;
                const pageTotalTime = row.frames.reduce((acc, f) => acc + (f.duration || 3.5), 0);

                return (
                  <div
                    key={row.scene.id}
                    onClick={() => setActivePageNumber(row.pageNumber)}
                    className={`rounded-xl border bg-card transition-all shadow-xs overflow-hidden cursor-pointer ${
                      isCurrentlyActiveInPreview
                        ? 'border-primary ring-2 ring-primary/30 shadow-md'
                        : 'border-border hover:border-muted-foreground/40'
                    }`}
                  >
                    {/* Card Header */}
                    <div className="bg-secondary/40 border-b border-border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                      {/* Left: Chapter & Page Identification */}
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-6 w-6 rounded-md flex items-center justify-center text-xs font-bold font-mono transition-colors ${
                            isCurrentlyActiveInPreview
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {String(row.pageNumber).padStart(2, '0')}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h2 className="text-xs sm:text-sm font-bold text-foreground">
                              {row.chapterLabel} — Página {String(row.pageNumber).padStart(2, '0')}
                            </h2>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-primary/10 text-primary flex items-center gap-1">
                              <Scissors className="h-2.5 w-2.5" />
                              {row.frames.length} cenas
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              ({pageTotalTime.toFixed(1)}s)
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-1.5">
                        {/* 1-Touch Automation: Alternar Ken Burns */}
                        {row.frames.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAlternateKenBurns(row);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-amber-500/10 text-amber-300 hover:bg-amber-500 hover:text-black border border-amber-500/25 transition-all cursor-pointer shadow-2xs"
                            title="Aplica automaticamente Zoom In nos quadros ímpares e Zoom Out nos pares desta página"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>⚡ Alternar Ken Burns</span>
                          </button>
                        )}

                        {/* Proportional Duration Distribution */}
                        {row.frames.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAutoDistributePageDurations(row);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border border-primary/25 transition-all cursor-pointer shadow-2xs"
                            title="Recalcular tempos proporcionalmente à quantidade de palavras do roteiro (base 140 palavras/minuto)"
                          >
                            <Sliders className="h-3 w-3" />
                            <span>⚡ Distribuir por Roteiro</span>
                          </button>
                        )}

                        {/* Preview Active Indicator Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePageNumber(row.pageNumber);
                            setIsPlayingPreview(true);
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                            isCurrentlyActiveInPreview
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'bg-secondary hover:bg-secondary/80 text-foreground'
                          }`}
                          title="Visualizar no Player de Preview da Direita"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>{isCurrentlyActiveInPreview ? 'No Player' : 'Ver'}</span>
                        </button>

                        {/* TTS Audio Listen Button */}
                        {hasText && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTogglePlayTts(row.scene);
                            }}
                            className={`p-1.5 rounded text-xs border transition-colors cursor-pointer ${
                              isPlaying
                                ? isPageTtsPaused
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                  : 'bg-destructive text-destructive-foreground border-destructive animate-pulse'
                                : 'bg-card border-border hover:bg-secondary text-foreground'
                            }`}
                            title={
                              isPlaying
                                ? isPageTtsPaused
                                  ? 'Continuar áudio (Pausado)'
                                  : 'Pausar áudio'
                                : 'Ouvir locução TTS da página'
                            }
                          >
                            {isPlaying ? (
                              isPageTtsPaused ? (
                                <Play className="h-3 w-3 fill-current" />
                              ) : (
                                <Pause className="h-3 w-3" />
                              )
                            ) : (
                              <Volume2 className="h-3 w-3 text-primary" />
                            )}
                          </button>
                        )}

                        {/* Neural API Audio Badge */}
                        {(pageAudioMap[row.pageNumber] || row.scene.audioUrl) && (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold"
                            title="Áudio neural pronto via API TTS"
                          >
                            <Volume2 className="h-3 w-3" />
                            <span>API ({(pageAudioMap[row.pageNumber]?.duration || row.scene.audioDuration || 0).toFixed(1)}s)</span>
                          </span>
                        )}

                        {/* Copy Text Button */}
                        {hasText && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyText(row.scene.text);
                            }}
                            className="p-1.5 rounded border border-border bg-card hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Copiar roteiro"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}

                        {/* Generate AI Script Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGeneratePageNarration(row);
                          }}
                          disabled={isGenerating}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shadow disabled:opacity-50 cursor-pointer"
                          title="Ler imagem bruta com IA e gerar narração para o YouTube"
                        >
                          <Zap className="h-3 w-3 fill-current" />
                          <span>{hasText ? 'Regenerar' : 'Gerar IA'}</span>
                        </button>

                        {/* Generate Neural TTS Audio Button */}
                        {hasText && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGeneratePageAudio(row);
                            }}
                            disabled={generatingAudioPages[row.pageNumber]}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-all shadow cursor-pointer ${
                              pageAudioMap[row.pageNumber] || row.scene.audioUrl
                                ? 'bg-emerald-600/90 text-white hover:bg-emerald-600'
                                : 'bg-secondary border border-border text-foreground hover:bg-secondary/80'
                            } disabled:opacity-50`}
                            title="Gerar áudio neural da narração via API TTS (OpenAI-compatible / 9router)"
                          >
                            {generatingAudioPages[row.pageNumber] ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span>Áudio...</span>
                              </>
                            ) : (
                              <>
                                <Mic className="h-3 w-3" />
                                <span>{pageAudioMap[row.pageNumber] || row.scene.audioUrl ? 'Regenerar Áudio' : 'Gerar Áudio API'}</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-3.5 sm:p-4 space-y-4">
                      {/* Section 1: Raw Image & Narration Script Editor */}
                      <div className="grid grid-cols-1 sm:grid-cols-[105px_minmax(0,1fr)] gap-3.5">
                        {/* Raw Page Thumbnail */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <BookOpen className="h-3 w-3 text-primary" />
                              Pág {row.pageNumber}
                            </span>
                          </div>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              if (row.rawPageUrl) {
                                setPreviewImageUrl({
                                  title: `${row.chapterLabel} — Página ${row.pageNumber}`,
                                  url: row.rawPageUrl,
                                });
                              }
                            }}
                            className="relative group rounded-lg border border-border bg-secondary/30 overflow-hidden h-32 flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                          >
                            {row.rawPageUrl ? (
                              <>
                                <img
                                  src={row.rawPageUrl}
                                  alt={`Página bruta ${row.pageNumber}`}
                                  className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white text-[10px] font-semibold gap-1">
                                  <Eye className="h-3.5 w-3.5" />
                                  <span>Ampliar</span>
                                </div>
                              </>
                            ) : (
                              <div className="text-center p-2 text-muted-foreground text-[10px]">
                                <BookOpen className="h-5 w-5 mx-auto mb-1 opacity-50" />
                                <span>Sem imagem</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Narration Script Textarea */}
                        <div className="flex flex-col space-y-1.5 min-w-0">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-foreground flex items-center gap-1">
                              <Sparkles className="h-3.5 w-3.5 text-primary" />
                              Roteiro da Narração
                            </span>
                            <span className="text-[11px] font-mono text-muted-foreground">
                              {durationEst.wordCount} pal · ~{durationEst.formatted} de fala
                            </span>
                          </div>

                          {/* Error Banner */}
                          {error && (
                            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="font-semibold">{error}</p>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGeneratePageNarration(row);
                                  }}
                                  className="mt-1 text-[11px] underline font-bold"
                                >
                                  Tentar Novamente
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="relative flex-1 min-h-[85px]">
                            {isGenerating && (
                              <div className="absolute inset-0 bg-card/85 backdrop-blur-xs z-10 rounded-lg border border-primary/40 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-primary">
                                <Zap className="h-4 w-4 animate-spin text-primary" />
                                <p>Lendo imagem e escrevendo roteiro com IA...</p>
                              </div>
                            )}

                            <textarea
                              value={row.scene.text}
                              onChange={(e) => {
                                const newText = e.target.value;
                                const durEst = estimateNarrationDuration(newText);
                                onUpdateScene({
                                  ...row.scene,
                                  text: newText,
                                  duration: durEst.formatted,
                                });
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder={`Clique em "Gerar IA" ou digite o roteiro desta página...`}
                              className="w-full h-full min-h-[85px] p-2.5 rounded-lg border border-border bg-secondary/15 hover:bg-secondary/25 focus:bg-background focus:border-primary focus:ring-1 focus:ring-primary outline-none text-xs text-foreground leading-relaxed resize-y transition-colors font-sans"
                            />
                          </div>

                          {/* Quick Profile Selection Pills */}
                          <div className="flex flex-wrap items-center gap-1 pt-0.5">
                            <span className="text-[10px] font-medium text-muted-foreground mr-1">
                              Perfil:
                            </span>
                            {NARRATION_PROFILES.map((prof) => {
                              const isActive = selectedProfileId === prof.id;
                              return (
                                <button
                                  key={prof.id}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedProfileId(prof.id);
                                    const nextConfig = { ...aiConfig, stylePreset: prof.id };
                                    setAiConfig(nextConfig);
                                    saveAiNarrationConfig(nextConfig);
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                                    isActive
                                      ? 'bg-primary/20 text-primary border border-primary/30 font-semibold'
                                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                                  }`}
                                  title={prof.description}
                                >
                                  {prof.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Cards das Cenas com Slider Linear Individual e Toggle Chips */}
                      <div className="space-y-2 pt-2 border-t border-border">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground flex items-center gap-1.5">
                            <Scissors className="h-3.5 w-3.5 text-primary" />
                            <span>Cenas Recortadas nesta Página ({row.frames.length})</span>
                          </span>
                          <span className="text-[10px] font-mono">
                            Ajuste a régua de 1s a 10s individual por cena
                          </span>
                        </div>

                        {row.frames.length === 0 ? (
                          <div className="text-xs text-muted-foreground p-3 bg-secondary/20 rounded border border-dashed border-border text-center">
                            Nenhum recorte salvo nesta página. Recorte quadros na tela de Recortes.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {row.frames.map((frame, fIdx) => {
                              const dur = frame.duration || 3.5;
                              const currentTrans = frame.transition || 'cut';
                              const isFrameActive = currentPreviewState.frame?.id === frame.id;

                              return (
                                <div
                                  key={frame.id}
                                  onClick={() => handleJumpToFrame(frame, row.pageNumber)}
                                  className={`flex flex-col p-2.5 rounded-lg border transition-all shadow-2xs cursor-pointer ${
                                    isFrameActive
                                      ? 'bg-secondary/40 border-primary ring-2 ring-primary/60 shadow-sm'
                                      : 'bg-secondary/20 border-border hover:border-primary/50 hover:bg-secondary/30'
                                  }`}
                                >
                                  {/* Top Row: Miniature, Label, Linear Range Slider & Delete */}
                                  <div className="flex items-start gap-2.5">
                                    {/* Thumbnail with Zoom & Jump Preview */}
                                    <div
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleJumpToFrame(frame, row.pageNumber);
                                      }}
                                      className="relative shrink-0 w-16 h-16 rounded border border-border overflow-hidden bg-black/20 cursor-pointer group mt-0.5 shadow-2xs"
                                      title="Clique para pular o preview para este quadro"
                                    >
                                      <img
                                        src={frame.src}
                                        alt={frame.label}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                        loading="lazy"
                                      />
                                      <div className="absolute inset-0 bg-primary/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                        <Play className="h-4 w-4 text-white fill-white drop-shadow" />
                                      </div>
                                      {onRemoveFrame && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveFrame(frame.id, frame.label, row.pageNumber);
                                          }}
                                          className="absolute top-0.5 right-0.5 h-4 w-4 rounded bg-black/80 hover:bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer"
                                          title={`Remover ${frame.label}`}
                                        >
                                          <Trash2 className="h-2.5 w-2.5" />
                                        </button>
                                      )}
                                      <span className="absolute bottom-0 inset-x-0 bg-black/75 text-[8px] font-mono text-white text-center truncate py-0.2">
                                        Q{fIdx + 1}
                                      </span>
                                    </div>

                                    {/* Details & Individual Linear Range Slider */}
                                    <div className="flex-1 min-w-0 space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold text-foreground truncate">
                                          {frame.label || `Cena ${fIdx + 1}`}
                                        </span>

                                        {/* Quick Jump to Preview Button */}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleJumpToFrame(frame, row.pageNumber);
                                          }}
                                          className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold transition-all cursor-pointer ${
                                            isFrameActive
                                              ? 'bg-primary text-primary-foreground shadow-2xs'
                                              : 'bg-secondary hover:bg-primary/20 hover:text-primary text-muted-foreground'
                                          }`}
                                          title="Pular o Player de Preview para o início deste quadro"
                                        >
                                          <Play className="h-2.5 w-2.5 fill-current" />
                                          <span>{isFrameActive ? 'Quadro Ativo' : 'Pular Preview'}</span>
                                        </button>
                                      </div>

                                      {/* Individual Linear Range Slider (1.0s to 10.0s) */}
                                      <FrameDurationSlider
                                        value={dur}
                                        frameId={frame.id}
                                        frameText={getFrameNarrationText(frame, row.frames, row.scene.text)}
                                        onChange={(newVal) => {
                                          if (onUpdateFrame) {
                                            onUpdateFrame(frame.id, { duration: newVal });
                                          }
                                        }}
                                      />
                                    </div>
                                  </div>

                                  {/* Atomic Narration Snippet for this specific frame */}
                                  {frame.narrationSnippet && (
                                    <div className="mt-1.5 px-2 py-1 rounded bg-background/60 border border-border/60 text-[10.5px] text-foreground italic leading-snug">
                                      “{frame.narrationSnippet}”
                                    </div>
                                  )}

                                  {/* Bottom Row: 1-Click Toggle Chips */}
                                  <div className="mt-2 pt-2 border-t border-border/60">
                                    <div className="flex items-center gap-1 w-full justify-between">
                                      {MOTION_CHIPS.map((chip) => {
                                        const isSelected = currentTrans === chip.id;
                                        return (
                                          <button
                                            key={chip.id}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleTransitionChange(frame.id, chip.id);
                                            }}
                                            className={`flex-1 py-1 px-1 rounded text-[10px] font-bold flex items-center justify-center gap-0.5 transition-all cursor-pointer border ${
                                              isSelected
                                                ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                                                : 'bg-background/80 hover:bg-secondary text-muted-foreground hover:text-foreground border-border/80'
                                            }`}
                                            title={chip.description}
                                          >
                                            <span className="text-[10px]">{chip.icon}</span>
                                            <span>{chip.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* COLUNA DIREITA (50%): Player de Preview em Tempo Real (Posição Fixa/Sticky) */}
        {/* ========================================================================= */}
        <div className="w-full lg:w-1/2 p-4 sm:p-5 lg:sticky lg:top-[53px] lg:self-start lg:h-[calc(100vh-53px)] overflow-y-auto bg-card/20 flex flex-col items-center justify-start space-y-4">
          {/* Header of Player: Title, Aspect Ratio Toggle & Scope Switcher */}
          <div className="w-full flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded bg-primary/10 text-primary flex items-center justify-center">
                <Video className="h-3.5 w-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <span>Player de Preview em Tempo Real</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-primary/15 text-primary font-bold">
                    Pág {activePageNumber}
                  </span>
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Aspect Ratio Selector (16:9 / 9:16) */}
              <div className="flex items-center bg-secondary rounded-md p-0.5 border border-border">
                <button
                  type="button"
                  onClick={() => setPreviewAspect('16:9')}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                    previewAspect === '16:9'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Formato Horizontal 16:9 (Padrão YouTube)"
                >
                  <Monitor className="h-3 w-3" />
                  <span>16:9</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewAspect('9:16')}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                    previewAspect === '9:16'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Formato Vertical 9:16 (Shorts / Reels / TikTok)"
                >
                  <Smartphone className="h-3 w-3" />
                  <span>9:16</span>
                </button>
              </div>

              {/* Scope Toggle: Página Atual vs Capítulo Completo */}
              <div className="flex items-center bg-secondary rounded-md p-0.5 border border-border">
                <button
                  type="button"
                  onClick={() => setPreviewScope('page')}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                    previewScope === 'page'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Reproduzir somente as cenas da página selecionada"
                >
                  Pág Atual
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewScope('chapter')}
                  className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer ${
                    previewScope === 'chapter'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title="Reproduzir todas as páginas do capítulo em sequência"
                >
                  Capítulo Todo
                </button>
              </div>
            </div>
          </div>

          {/* Audio Source Status Banner for Preview */}
          <div className="w-full max-w-xl flex items-center justify-between px-3 py-1.5 rounded-lg border border-border bg-card text-xs">
            <div className="flex items-center gap-2">
              {pageAudioMap[activePageNumber] || activeRow?.scene.audioUrl ? (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Áudio da API ({aiConfig.ttsModel?.split('/').pop() || 'pt-BR-AntonioNeural'} · {(pageAudioMap[activePageNumber]?.duration || activeRow?.scene.audioDuration || 0).toFixed(1)}s)</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-[11px]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Voz do Navegador (Áudio da API ainda não gerado nesta pág)</span>
                </span>
              )}
            </div>

            {!(pageAudioMap[activePageNumber] || activeRow?.scene.audioUrl) && activeRow && activeRow.scene.text.trim() && (
              <button
                type="button"
                onClick={() => handleGeneratePageAudio(activeRow)}
                disabled={generatingAudioPages[activePageNumber]}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-bold hover:opacity-90 cursor-pointer shadow-2xs"
              >
                {generatingAudioPages[activePageNumber] ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Gerando Áudio...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-3 w-3" />
                    <span>Gerar Áudio da API</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Video Canvas Container (16:9 or 9:16 with CSS Animation simulation) */}
          <div className="w-full flex items-center justify-center py-1">
            <div
              className={`relative overflow-hidden rounded-xl border border-border bg-black shadow-2xl flex items-center justify-center transition-all ${
                previewAspect === '16:9'
                  ? 'w-full max-w-xl aspect-video'
                  : 'w-[250px] aspect-[9/16] max-h-[460px]'
              }`}
            >
              {currentPreviewState.frame ? (
                <div className="relative w-full h-full overflow-hidden flex items-center justify-center">
                  <img
                    src={currentPreviewState.frame.src}
                    alt={currentPreviewState.frame.label}
                    style={getTransitionStyle(
                      currentPreviewState.frame.transition,
                      currentPreviewState.progress
                    )}
                    className="w-full h-full object-cover select-none pointer-events-none will-change-transform"
                  />

                  {/* Transition effect pill overlay */}
                  <div className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded bg-black/75 text-white text-[10px] font-mono backdrop-blur border border-white/15 shadow flex items-center gap-1">
                      <span>{MOTION_CHIPS.find((c) => c.id === currentPreviewState.frame?.transition)?.icon || '✕'}</span>
                      <span>
                        {MOTION_CHIPS.find((c) => c.id === currentPreviewState.frame?.transition)?.fullLabel || 'Corte Seco'}
                      </span>
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-primary/80 text-white text-[10px] font-mono font-bold shadow">
                      Pág {currentPreviewState.pageNumber}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center p-6 text-muted-foreground space-y-1.5">
                  <Video className="h-10 w-10 mx-auto opacity-30" />
                  <p className="text-xs">Nenhum recorte disponível para preview nesta página.</p>
                </div>
              )}

              {/* Timecode Badge Top Right */}
              <div className="absolute top-2.5 right-2.5 z-20 rounded bg-black/80 px-2 py-0.5 text-[10px] font-mono font-bold text-white backdrop-blur border border-white/15">
                {previewCurrentTime.toFixed(1)}s / {previewTotalDuration.toFixed(1)}s
              </div>
            </div>
          </div>

          {/* Player Control Bar (Play, Scrubber, Time, TTS) */}
          <div className="w-full max-w-xl rounded-lg border border-border bg-card p-2.5 space-y-2 shadow-xs">
            <div className="flex items-center gap-2.5">
              {/* Play / Pause Toggle */}
              <button
                type="button"
                onClick={handleTogglePlayPausePreview}
                className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity shadow cursor-pointer shrink-0"
                title={isPlayingPreview ? 'Pausar' : 'Reproduzir Preview'}
              >
                {isPlayingPreview ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5 ml-0.5 fill-current" />
                )}
              </button>

              {/* Restart Button */}
              <button
                type="button"
                onClick={() => {
                  setPreviewCurrentTime(0);
                  setIsPlayingPreview(false);
                  if (masterAudioRef.current) {
                    masterAudioRef.current.pause();
                    masterAudioRef.current.currentTime = 0;
                  }
                  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                  isTtsPausedRef.current = false;
                  lastSpokenFrameIdRef.current = null;
                  isSpeechSpeakingRef.current = false;
                }}
                className="grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground transition-colors cursor-pointer shrink-0"
                title="Voltar ao Início"
              >
                <RotateCcw className="h-3 w-3" />
              </button>

              {/* Ultra-fluid Scrubber Progress Bar with Frame Markers & Drag Seeking */}
              <PlayerScrubberBar
                currentTime={previewCurrentTime}
                totalDuration={previewTotalDuration}
                frames={activePreviewFrames}
                onSeek={(newTime) => {
                  setPreviewCurrentTime(newTime);
                  const pageAudio = pageAudioMap[activePageNumber] || (activeRow?.scene.audioUrl ? { audioUrl: activeRow.scene.audioUrl } : null);
                  if (masterAudioRef.current && pageAudio) {
                    masterAudioRef.current.currentTime = newTime;
                  }
                  // If playing with fallback TTS, update speech cleanly
                  if (enablePreviewTts && isPlayingPreview && (!pageAudio || !pageAudio.audioUrl) && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                    isSpeechSpeakingRef.current = false;
                    lastSpokenFrameIdRef.current = null;
                  }
                }}
              />

              {/* Time display */}
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground font-semibold">
                {previewCurrentTime.toFixed(1)}s / {previewTotalDuration.toFixed(1)}s
              </span>

              {/* Voice TTS Toggle in Preview */}
              <button
                type="button"
                onClick={() => {
                  const nextVal = !enablePreviewTts;
                  setEnablePreviewTts(nextVal);
                  if (masterAudioRef.current) {
                    masterAudioRef.current.muted = !nextVal;
                  }
                  if (!nextVal && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel();
                  }
                }}
                className={`p-1.5 rounded-md border text-xs transition-colors cursor-pointer ${
                  enablePreviewTts
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-secondary'
                }`}
                title={enablePreviewTts ? 'Áudio/Locução Ativo' : 'Áudio Mudo'}
              >
                {enablePreviewTts ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Current Frame Details & Quick Montagem Action Card */}
          <div className="w-full max-w-xl rounded-lg border border-border bg-card p-3 space-y-2 text-xs shadow-2xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                Quadro Ativo no Preview
              </span>
              {currentPreviewState.frame && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary font-bold">
                  {currentPreviewState.frameIndex + 1} de {activePreviewFrames.length} cenas
                </span>
              )}
            </div>

            {currentPreviewState.frame ? (
              <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-border">
                <div>
                  <span className="text-muted-foreground">Etiqueta: </span>
                  <strong className="text-foreground">{currentPreviewState.frame.label}</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Duração: </span>
                  <strong className="text-primary font-mono">{currentPreviewState.frame.duration || 3.5}s</strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Efeito: </span>
                  <strong className="text-foreground">
                    {MOTION_CHIPS.find((c) => c.id === currentPreviewState.frame?.transition)?.fullLabel || 'Corte Seco'}
                  </strong>
                </div>
                <div>
                  <span className="text-muted-foreground">Progresso: </span>
                  <strong className="text-foreground font-mono">
                    {Math.round(currentPreviewState.progress * 100)}%
                  </strong>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-[11px]">Nenhum quadro selecionado.</p>
            )}

            {onGoToMontagem && (
              <div className="pt-2 border-t border-border flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  Gostou dos tempos e transições?
                </span>
                <button
                  type="button"
                  onClick={onGoToMontagem}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-opacity shadow cursor-pointer"
                >
                  <span>Ir para Timeline Final</span>
                  <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* High-Res Image Preview Modal */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="p-3 border-b border-border flex items-center justify-between bg-secondary/40">
              <h3 className="text-xs sm:text-sm font-bold text-foreground">
                {previewImageUrl.title}
              </h3>
              <button
                onClick={() => setPreviewImageUrl(null)}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-black/20">
              <img
                src={previewImageUrl.url}
                alt={previewImageUrl.title}
                className="max-h-[75vh] max-w-full object-contain rounded shadow"
              />
            </div>
          </div>
        </div>
      )}

      {/* 9router & AI Configuration Modal */}
      {isConfigModalOpen && (
        <div
          onClick={() => setIsConfigModalOpen(false)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-scale-up"
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Configurações da API de Narração (9router)
                </h3>
              </div>
              <button
                onClick={() => setIsConfigModalOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-foreground flex items-center justify-between">
                  <span>Base URL do 9router</span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    OpenAI-compatible (/v1)
                  </span>
                </label>
                <input
                  type="text"
                  value={aiConfig.baseURL}
                  onChange={(e) =>
                    setAiConfig({ ...aiConfig, baseURL: e.target.value.trim() })
                  }
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-md border border-border bg-background font-mono text-xs text-foreground focus:border-primary outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground flex items-center justify-between">
                  <span>API Key</span>
                  <span className="text-[10px] text-muted-foreground">9router secret</span>
                </label>
                <input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) =>
                    setAiConfig({ ...aiConfig, apiKey: e.target.value.trim() })
                  }
                  placeholder="sk-..."
                  className="w-full px-3 py-2 rounded-md border border-border bg-background font-mono text-xs text-foreground focus:border-primary outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">Modelo de Visão</label>
                <select
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-xs text-foreground focus:border-primary outline-none cursor-pointer"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.badge}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">
                  Perfil Padrão da Narração (YouTube)
                </label>
                <select
                  value={selectedProfileId}
                  onChange={(e) => {
                    setSelectedProfileId(e.target.value);
                    setAiConfig({ ...aiConfig, stylePreset: e.target.value });
                  }}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-xs text-foreground focus:border-primary outline-none cursor-pointer"
                >
                  {NARRATION_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} — {p.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-foreground">
                  Modelo de Voz TTS da API (Edge-TTS / OpenAI-compatible)
                </label>
                <select
                  value={aiConfig.ttsModel || DEFAULT_AI_CONFIG.ttsModel}
                  onChange={(e) => setAiConfig({ ...aiConfig, ttsModel: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-xs text-foreground focus:border-primary outline-none cursor-pointer"
                >
                  {AVAILABLE_TTS_MODELS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.badge}
                    </option>
                  ))}
                </select>
              </div>

              {connectionTestResult && (
                <div
                  className={`p-3 rounded-md text-xs border flex items-start gap-2 ${
                    connectionTestResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-destructive/10 border-destructive/30 text-destructive'
                  }`}
                >
                  {connectionTestResult.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {connectionTestResult.success
                        ? 'Servidor 9router conectado com sucesso!'
                        : 'Não foi possível alcançar o 9router'}
                    </p>
                    <p className="opacity-90">{connectionTestResult.message}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className="px-3 py-1.5 rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {isTestingConnection ? (
                  <Zap className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                <span>Testar Conexão</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAiConfig(DEFAULT_AI_CONFIG)}
                  className="px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Restaurar Padrão
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleSaveConfig(aiConfig);
                    setIsConfigModalOpen(false);
                  }}
                  className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 shadow cursor-pointer"
                >
                  Salvar Configuração
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur animate-fade-in text-xs font-semibold ${
            toastMessage.type === 'error'
              ? 'border-destructive/30 bg-destructive/90 text-destructive-foreground'
              : toastMessage.type === 'info'
              ? 'border-blue-500/30 bg-blue-900/90 text-blue-100'
              : 'border-emerald-500/30 bg-emerald-900/90 text-emerald-100'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="h-4 w-4" />
          ) : toastMessage.type === 'info' ? (
            <Sparkles className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
};
