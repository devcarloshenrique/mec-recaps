import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Minus,
  FolderUp,
  Check,
  Crop,
  Trash2,
  ZoomIn,
  ZoomOut,
  Crosshair,
  Download,
  Eye,
  X,
  Sparkles,
  Maximize2,
  Move,
  CheckCircle2,
  Hand,
  Grid,
  RotateCw,
  Plus,
  Keyboard,
  HelpCircle,
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpDown,
  CheckSquare,
  Square,
  RotateCcw,
  Wand2,
  Layers,
  Loader2,
  SlidersHorizontal,
  Cpu,
  Zap,
  Boxes,
  BookOpen,
  Sliders,
  ShieldCheck,
  MessageSquareOff,
  Clock,
} from 'lucide-react';
import { AspectRatio, ChapterItem, CropRect, FrameItem } from '../types';
import {
  detectPanels,
  DetectionAlgorithm,
  DetectedPanel,
  extractPanelToDataUrl,
  extractPanelToBlobAndUrl,
  canvasToBlob,
  getClosestAspectRatio,
  loadImage,
  ALGORITHM_INFO,
  filter_text_and_speech_bubbles,
  evaluate_crop_patch,
} from '../utils/panelDetection';
import { registerCreatedUrl, revokeCreatedUrl } from '../utils/projectStorage';
import {
  getChapterThumbnails,
  generateChapterThumbnailsSequentially,
} from '../utils/thumbnailCache';

interface RecorteViewProps {
  chapters: ChapterItem[];
  currentChapterId: string;
  onSelectChapter: (id: string) => void;
  currentPageNumber: number;
  onSelectPageNumber: (page: number) => void;
  frames: FrameItem[];
  onAddFrame: (frame: FrameItem) => void;
  onAddFramesBatch?: (frames: FrameItem[]) => void;
  onRemoveFrame: (id: string) => void;
  onUpdateFrame?: (id: string, partial: Partial<FrameItem>) => void;
  onUploadFolder: (files: FileList | File[]) => void;
  onDeleteChapter?: (id: string) => boolean | void;
  onDeleteChapters?: (ids: string[]) => void;
  onClearAllChapters?: () => void;
  onSortChapters?: (mode: 'asc' | 'desc' | 'reverse') => void;
  onAddChapter?: (files?: FileList | File[]) => void;
  chapterPanels?: Record<string, Record<number, DetectedPanel[]>>;
  onUpdateChapterPanels?: React.Dispatch<React.SetStateAction<Record<string, Record<number, DetectedPanel[]>>>>;
}

const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', 'Livre'];

// Audio shutter sound generator using Web Audio API
function playShutterSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.09);
  } catch {
    // audio context not allowed without user interaction
  }
}

export type PhotoshopTool = 'crop' | 'hand' | 'move' | 'zoom';

export const RecorteView: React.FC<RecorteViewProps> = ({
  chapters,
  currentChapterId,
  onSelectChapter,
  currentPageNumber,
  onSelectPageNumber,
  frames,
  onAddFrame,
  onAddFramesBatch,
  onRemoveFrame,
  onUpdateFrame,
  onUploadFolder,
  onDeleteChapter,
  onDeleteChapters,
  onClearAllChapters,
  onSortChapters,
  onAddChapter,
  chapterPanels: propChapterPanels,
  onUpdateChapterPanels,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);

  // Photoshop Active Tool
  const [activeTool, setActiveTool] = useState<PhotoshopTool>('crop');
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ startX: number; startY: number; panX: number; panY: number }>({
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });

  // Chapter Bulk & Sort States
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState<boolean>(false);
  const [isBulkSelectMode, setIsBulkSelectMode] = useState<boolean>(false);
  const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
  const [isClearAllModalOpen, setIsClearAllModalOpen] = useState<boolean>(false);
  const [isChaptersDrawerOpen, setIsChaptersDrawerOpen] = useState<boolean>(false);
  const [inspectorTab, setInspectorTab] = useState<'manual' | 'auto'>('manual');

  // Automatic Panel Detection State (Fase 1: Projeção de Perfil, Morfologia, SAHI, Híbrido)
  // Store detected panel selections per chapter and page: { [chapterId]: { [pageNumber]: DetectedPanel[] } }
  // When lifted to parent, preserves detections across tab switches and page reloads
  const [localChapterPanels, setLocalChapterPanels] = useState<Record<string, Record<number, DetectedPanel[]>>>({});
  const chapterPanels = propChapterPanels ?? localChapterPanels;
  const setChapterPanels = onUpdateChapterPanels ?? setLocalChapterPanels;
  const chapterPanelsRef = useRef<Record<string, Record<number, DetectedPanel[]>>>(chapterPanels);
  useEffect(() => {
    chapterPanelsRef.current = chapterPanels;
  }, [chapterPanels]);

  const currentChapterPanels = chapterPanels[currentChapterId] || {};
  const detectedPanels = currentChapterPanels[currentPageNumber] || [];

  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<DetectionAlgorithm>('profile');
  const [gutterThreshold, setGutterThreshold] = useState<number>(20);
  const [minPanelHeight, setMinPanelHeight] = useState<number>(45);
  const [panelPadding, setPanelPadding] = useState<number>(4);
  const [sahiSliceHeight, setSahiSliceHeight] = useState<number>(1000);
  const [sahiOverlap, setSahiOverlap] = useState<number>(25);
  const [filterTextBubbles, setFilterTextBubbles] = useState<boolean>(true);
  const [textFilterThreshold, setTextFilterThreshold] = useState<number>(0.55);
  const [isAutoDetectModalOpen, setIsAutoDetectModalOpen] = useState<boolean>(false);
  const [autoDetectModalTab, setAutoDetectModalTab] = useState<'execute' | 'comparative' | 'guide'>('execute');
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [batchProgress, setBatchProgress] = useState<{
    mode: 'detect' | 'crop';
    current: number;
    total: number;
    count: number;
  }>({
    mode: 'detect',
    current: 0,
    total: 0,
    count: 0,
  });

  // UI preferences
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);
  const [chapterToDelete, setChapterToDelete] = useState<ChapterItem | null>(null);

  const [selectedRatio, setSelectedRatio] = useState<AspectRatio>('16:9');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isFullWidthMode, setIsFullWidthMode] = useState<boolean>(true);

  // Natural image dimensions
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number }>({
    width: 704,
    height: 1408,
  });

  // Normalized crop box in NATURAL IMAGE PIXELS
  const [cropBox, setCropBox] = useState<CropRect>({
    x: 42,
    y: 225,
    width: 620,
    height: 349, // 16:9
  });

  // Selected / Active panel ID from detectedPanels
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

  // Live drawing rectangle when dragging with tool C
  const [drawingBox, setDrawingBox] = useState<CropRect | null>(null);
  const drawingBoxRef = useRef<CropRect | null>(null);

  // Dragging & drawing crop box state
  const [dragMode, setDragMode] = useState<
    'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e' | 'draw' | null
  >(null);
  const [dragStart, setDragStart] = useState<{
    clientX: number;
    clientY: number;
    crop: CropRect;
    naturalStart: { x: number; y: number };
  }>({
    clientX: 0,
    clientY: 0,
    crop: { x: 0, y: 0, width: 0, height: 0 },
    naturalStart: { x: 0, y: 0 },
  });

  const dragRef = useRef<{
    isDragging: boolean;
    mode: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e' | 'draw' | null;
    startX: number;
    startY: number;
    crop: CropRect;
    naturalStart: { x: number; y: number };
  }>({
    isDragging: false,
    mode: null,
    startX: 0,
    startY: 0,
    crop: { x: 0, y: 0, width: 0, height: 0 },
    naturalStart: { x: 0, y: 0 },
  });

  const [isCropFlashing, setIsCropFlashing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<FrameItem | null>(null);
  const [isFolderDragging, setIsFolderDragging] = useState<boolean>(false);

  const currentChapter = chapters.find((c) => c.id === currentChapterId) || chapters[0] || {
    id: 'empty',
    label: 'Sem Capítulo',
    pages: 0,
    done: 0,
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // Resolve current page image URL - returns empty string if no chapter images loaded
  const getPageUrl = (pageNum: number): string => {
    if (currentChapter.imageUrls && currentChapter.imageUrls.length > 0) {
      const idx = (pageNum - 1) % currentChapter.imageUrls.length;
      return currentChapter.imageUrls[idx];
    }
    return '';
  };

  const currentImageUrl = getPageUrl(currentPageNumber);

  // Progressive hydration of low-res proxy thumbnails (80x128px, ~2.5KB each)
  const [chapterThumbnails, setChapterThumbnails] = useState<Record<number, string>>({});

  useEffect(() => {
    let isCancelled = false;

    if (!currentChapterId || !currentChapter.imageUrls || currentChapter.imageUrls.length === 0) {
      setChapterThumbnails({});
      return;
    }

    // 1. Check if already cached in memory or IndexedDB
    getChapterThumbnails(currentChapterId).then((cached) => {
      if (isCancelled) return;
      if (cached && Object.keys(cached).length > 0) {
        setChapterThumbnails(cached);
      }
    });

    // 2. Run sequential background generation for missing pages (yields 12ms per page)
    generateChapterThumbnailsSequentially(
      currentChapterId,
      currentChapter.imageUrls,
      (pageNum, thumbUrl) => {
        if (isCancelled) return;
        setChapterThumbnails((prev) => ({
          ...prev,
          [pageNum]: thumbUrl,
        }));
      }
    );

    return () => {
      isCancelled = true;
    };
  }, [currentChapterId, currentChapter.imageUrls]);

  // Stats for current chapter panel selections
  const totalChapterPanels = Object.values(currentChapterPanels).reduce(
    (sum, list) => sum + list.length,
    0
  );
  const pagesWithPanelsCount = Object.keys(currentChapterPanels).filter(
    (pNum) => (currentChapterPanels[Number(pNum)] || []).length > 0
  ).length;

  // Filter frames for this chapter and page
  const pageFrames = frames.filter(
    (f) => (!f.chapterId || f.chapterId === currentChapterId) && (!f.pageNumber || f.pageNumber === currentPageNumber)
  );

  // Find an existing frame corresponding to a target panel / crop selection
  const findExistingFrame = useCallback(
    (target: { id?: string; frameId?: string; label?: string; x?: number; y?: number; width?: number; height?: number }) => {
      // 1. Direct primary frameId match
      if (target.frameId) {
        const byFrameId = pageFrames.find((f) => f.id === target.frameId);
        if (byFrameId) return byFrameId;
      }

      // 2. Direct panelId or frame id match
      if (target.id) {
        const byId = pageFrames.find((f) => f.panelId === target.id || f.id === target.id);
        if (byId) return byId;
      }

      // 3. Number / Label match (e.g. Quadro 01, Quadro 01 · Confronto Sombrio, Zona 01)
      if (target.label) {
        const targetNum = target.label.match(/\d+/)?.[0];
        if (targetNum) {
          const byNum = pageFrames.find((f) => {
            if (!f.label) return false;
            const fNum = f.label.match(/\d+/)?.[0];
            return fNum === targetNum;
          });
          if (byNum) return byNum;
        }

        const cleanTarget = target.label.split(/[·\-\(]/)[0].trim().toLowerCase();
        const byCleanLabel = pageFrames.find((f) => {
          if (!f.label) return false;
          const cleanF = f.label.split(/[·\-\(]/)[0].trim().toLowerCase();
          return cleanTarget === cleanF;
        });
        if (byCleanLabel) return byCleanLabel;
      }

      // 4. Vertical overlap on page
      if (typeof target.y === 'number' && typeof target.height === 'number' && target.height > 0) {
        const byOverlap = pageFrames.find((f) => {
          if (!f.cropRect) return false;
          const y1 = Math.max(f.cropRect.y, target.y!);
          const y2 = Math.min(f.cropRect.y + f.cropRect.height, target.y! + target.height!);
          return (y2 - y1) > 20;
        });
        if (byOverlap) return byOverlap;
      }

      return null;
    },
    [pageFrames]
  );

  // Check if a panel / crop selection has already been cut into pageFrames
  const isSelectionAlreadyCropped = useCallback(
    (target: { id?: string; label?: string; x: number; y: number; width: number; height: number }) => {
      return Boolean(findExistingFrame(target));
    },
    [findExistingFrame]
  );

  // Unified frames & zones list for the current page
  // Combines detectedPanels (zones on canvas) and pageFrames (cropped output on timeline)
  const unifiedItems = useMemo(() => {
    const matchedFrameIds = new Set<string>();

    type UnifiedItem = {
      id: string;
      panelId: string | null;
      frameId: string | null;
      label: string;
      panel: DetectedPanel | null;
      frame: FrameItem | null;
      isCropped: boolean;
      src: string | null;
      ratio: string | null;
      width: number;
      height: number;
      x: number;
      y: number;
    };

    const items: UnifiedItem[] = detectedPanels.map((dp, idx) => {
      const dpNum = dp.label ? dp.label.match(/\d+/)?.[0] : String(idx + 1);

      // Find matching cropped frame
      const matchingFrame = pageFrames.find((f) => {
        if (matchedFrameIds.has(f.id)) return false;

        // 1. Exact panelId
        if (f.panelId && (f.panelId === dp.id || f.panelId === `panel_${idx + 1}`)) return true;

        // 2. Number in label or cleaned prefix
        if (f.label) {
          const fNum = f.label.match(/\d+/)?.[0];
          if (dpNum && fNum && dpNum === fNum) return true;

          const cleanDp = dp.label?.split(/[·\-\(]/)[0].trim().toLowerCase();
          const cleanF = f.label.split(/[·\-\(]/)[0].trim().toLowerCase();
          if (cleanDp && cleanDp === cleanF) return true;
        }

        // 3. Vertical overlap on page
        if (f.cropRect) {
          const y1 = Math.max(f.cropRect.y, dp.y);
          const y2 = Math.min(f.cropRect.y + f.cropRect.height, dp.y + dp.height);
          if (y2 - y1 > 20) return true;
        }

        return false;
      });

      if (matchingFrame) {
        matchedFrameIds.add(matchingFrame.id);
      }

      const isCurr = dp.id === selectedPanelId;
      const liveW = Math.round(isCurr ? cropBox.width : (matchingFrame?.cropRect?.width || dp.width));
      const liveH = Math.round(isCurr ? cropBox.height : (matchingFrame?.cropRect?.height || dp.height));
      const liveRatio = liveW && liveH ? getClosestAspectRatio(liveW, liveH) : null;

      return {
        id: dp.id,
        panelId: dp.id,
        frameId: matchingFrame?.id || null,
        label: dp.label || matchingFrame?.label || `Quadro ${String(idx + 1).padStart(2, '0')}`,
        panel: dp,
        frame: matchingFrame || null,
        isCropped: Boolean(matchingFrame),
        src: matchingFrame?.src || null,
        ratio: matchingFrame?.ratio || liveRatio,
        width: liveW,
        height: liveH,
        x: Math.round(isCurr ? cropBox.x : (matchingFrame?.cropRect?.x ?? dp.x)),
        y: Math.round(isCurr ? cropBox.y : (matchingFrame?.cropRect?.y ?? dp.y)),
      };
    });

    // Add any pageFrames that were cropped manually without an existing detectedPanel
    pageFrames.forEach((f, idx) => {
      if (!matchedFrameIds.has(f.id)) {
        items.push({
          id: f.id,
          panelId: null,
          frameId: f.id,
          label: f.label || `Quadro ${String(items.length + idx + 1).padStart(2, '0')}`,
          panel: null,
          frame: f,
          isCropped: true,
          src: f.src,
          ratio: f.ratio || null,
          width: Math.round(f.cropRect?.width || 0),
          height: Math.round(f.cropRect?.height || 0),
          x: Math.round(f.cropRect?.x || 0),
          y: Math.round(f.cropRect?.y || 0),
        });
      }
    });

    return items;
  }, [detectedPanels, pageFrames, selectedPanelId, cropBox]);

  // Ratio numerical factor
  const getRatioValue = useCallback((): number | null => {
    switch (selectedRatio) {
      case '16:9': return 16 / 9;
      case '9:16': return 9 / 16;
      case '1:1': return 1;
      case '4:3': return 4 / 3;
      default: return null;
    }
  }, [selectedRatio]);

  // Set detected panels for a specific page of current chapter
  const setPageDetectedPanels = useCallback(
    (pageNum: number, panels: DetectedPanel[]) => {
      setChapterPanels((prev) => ({
        ...prev,
        [currentChapterId]: {
          ...(prev[currentChapterId] || {}),
          [pageNum]: panels,
        },
      }));
    },
    [currentChapterId]
  );

  // Synchronize active panel dimensions with chapterPanels
  const syncPanelCoords = useCallback(
    (panelId: string, rect: CropRect) => {
      setChapterPanels((prev) => {
        const chap = prev[currentChapterId] || {};
        const pagePanels = chap[currentPageNumber] || [];
        return {
          ...prev,
          [currentChapterId]: {
            ...chap,
            [currentPageNumber]: pagePanels.map((p) =>
              p.id === panelId
                ? { ...p, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                : p
            ),
          },
        };
      });
    },
    [currentChapterId, currentPageNumber]
  );

  // Handle natural image load
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const natW = img.naturalWidth;
      const natH = img.naturalHeight;
      setNaturalDimensions({
        width: natW,
        height: natH,
      });
    }
  };

  // Change Aspect Ratio and adapt current box
  const applyRatio = (ratio: AspectRatio) => {
    setSelectedRatio(ratio);
    if (ratio === 'Livre') return;

    let r = 16 / 9;
    if (ratio === '9:16') r = 9 / 16;
    else if (ratio === '1:1') r = 1;
    else if (ratio === '4:3') r = 4 / 3;

    const natW = naturalDimensions.width;
    const natH = naturalDimensions.height;

    setCropBox((prev) => {
      let newW = prev.width;
      let newH = Math.round(newW / r);

      if (newH > natH) {
        newH = Math.round(natH * 0.7);
        newW = Math.round(newH * r);
      }
      if (newW > natW) {
        newW = Math.round(natW * 0.9);
        newH = Math.round(newW / r);
      }

      const newX = Math.max(0, Math.min(natW - newW, prev.x));
      const newY = Math.max(0, Math.min(natH - newH, prev.y));

      const next = {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      };
      if (selectedPanelId) {
        syncPanelCoords(selectedPanelId, next);
      }
      return next;
    });
  };

  // Preset alignment tools
  const handleCenterCrop = () => {
    const natW = naturalDimensions.width;
    const natH = naturalDimensions.height;
    setCropBox((prev) => {
      const next = {
        ...prev,
        x: Math.max(0, Math.round((natW - prev.width) / 2)),
        y: Math.max(0, Math.round((natH - prev.height) / 2)),
      };
      if (selectedPanelId) {
        syncPanelCoords(selectedPanelId, next);
      }
      return next;
    });
    setPanOffset({ x: 0, y: 0 });
    showToast('Enquadramento centralizado na página');
  };

  const handleFitWidth = () => {
    const natW = naturalDimensions.width;
    const natH = naturalDimensions.height;
    const targetW = Math.round(natW * 0.94);
    const r = getRatioValue() || 16 / 9;
    const targetH = Math.round(targetW / r);

    setCropBox((prev) => {
      const next = {
        x: Math.round((natW - targetW) / 2),
        y: Math.max(0, Math.min(natH - targetH, prev.y)),
        width: targetW,
        height: targetH,
      };
      if (selectedPanelId) {
        syncPanelCoords(selectedPanelId, next);
      }
      return next;
    });
    showToast('Largura ajustada');
  };

  const handleSnapToPanel = (panel: 'top' | 'middle' | 'bottom') => {
    const natH = naturalDimensions.height;
    let targetY = 40;
    if (panel === 'middle') targetY = Math.round(natH * 0.35);
    else if (panel === 'bottom') targetY = Math.round(natH * 0.65);

    setCropBox((prev) => {
      const next = {
        ...prev,
        y: Math.min(natH - prev.height, targetY),
      };
      if (selectedPanelId) {
        syncPanelCoords(selectedPanelId, next);
      }
      return next;
    });
  };

  // Fit to screen calculation: fits the full image from beginning to end
  const handleFitToScreen = () => {
    const vp = viewportRef.current;
    const img = imageRef.current;
    if (!vp) return;

    const vpW = Math.max(100, vp.clientWidth - 48); // account for padding
    const vpH = Math.max(100, vp.clientHeight - 48);

    const natW = img?.naturalWidth || naturalDimensions.width || 704;
    const natH = img?.naturalHeight || naturalDimensions.height || 1408;

    // At zoomLevel = 100%, image width is 440px and rendered height is 440 * (natH / natW)
    const baseWidthAt100 = 440;
    const baseHeightAt100 = baseWidthAt100 * (natH / natW);

    // Zoom needed to fit height completely
    const zoomToFitHeight = (vpH / baseHeightAt100) * 100;
    // Zoom needed to fit width completely
    const zoomToFitWidth = (vpW / baseWidthAt100) * 100;

    // To see the entire image "do começo ao fim", both width AND height must fit within the viewport
    const fitZoom = Math.min(zoomToFitHeight, zoomToFitWidth);
    const idealZoom = Math.max(5, Math.min(200, Math.round(fitZoom)));

    setZoomLevel(idealZoom);
    setPanOffset({ x: 0, y: 0 });
    showToast(`Visão geral ajustada: ${idealZoom}%`);
  };

  // Rotate canvas
  const handleRotate = () => {
    setRotationAngle((prev) => (prev + 90) % 360);
    showToast(`Orientação girada em 90°`);
  };

  // Focus viewport smoothly on a specific crop box
  const focusCropBox = useCallback(
    (box: { x?: number; y?: number; width?: number; height?: number }) => {
      const vp = viewportRef.current;
      const imgContainer = imageContainerRef.current;
      const img = imageRef.current;
      if (!vp || !imgContainer || !img) return;

      const natW = img.naturalWidth || naturalDimensions.width || 704;
      const natH = img.naturalHeight || naturalDimensions.height || 1408;

      const vpHeight = vp.clientHeight || 700;
      const imgHeight = imgContainer.clientHeight || img.clientHeight || (natH * (((zoomLevel / 100) * 440) / natW));
      const scaleY = imgHeight / natH;

      const boxY = typeof box.y === 'number' ? box.y : 0;
      const boxH = typeof box.height === 'number' && box.height > 0 ? box.height : Math.round(natH * 0.2);
      const boxCenterYInImage = (boxY + boxH / 2) * scaleY;

      // untranslatedTop is the top of image container relative to viewport (typically 24px from p-6)
      const untranslatedTop = imgContainer.offsetTop || 0;

      // targetPanY centers boxCenterYInImage exactly in the middle of viewport
      const targetPanY = (vpHeight / 2) - untranslatedTop - boxCenterYInImage;

      setPanOffset({
        x: 0,
        y: Math.round(targetPanY),
      });
    },
    [naturalDimensions, zoomLevel]
  );

  // Reset pan on page or chapter change
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 });
  }, [currentPageNumber, currentChapterId]);

  // Non-passive wheel listener for smooth zoom (Ctrl+wheel) and pan (wheel / trackpad)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 10 : -10;
        setZoomLevel((z) => Math.max(5, Math.min(240, z + delta)));
      } else {
        e.preventDefault();
        setPanOffset((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    vp.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      vp.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // Delete chapter handling with confirmation
  const handleRequestDeleteChapter = (e: React.MouseEvent, ch: ChapterItem) => {
    e.stopPropagation();
    setChapterToDelete(ch);
  };

  const handleConfirmDeleteChapter = () => {
    if (!chapterToDelete) return;
    const deletedLabel = chapterToDelete.label;
    if (onDeleteChapter) {
      onDeleteChapter(chapterToDelete.id);
    }
    setChapterToDelete(null);
    showToast(`Capítulo "${deletedLabel}" excluído com sucesso.`);
  };

  // Bulk selection handlers
  const handleToggleSelectChapter = (id: string) => {
    setSelectedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllChapters = () => {
    if (selectedChapterIds.size === chapters.length) {
      setSelectedChapterIds(new Set());
    } else {
      setSelectedChapterIds(new Set(chapters.map((c) => c.id)));
    }
  };

  const handleConfirmBulkDelete = () => {
    const ids = Array.from(selectedChapterIds);
    if (ids.length === 0) return;
    if (onDeleteChapters) {
      onDeleteChapters(ids);
    } else if (onDeleteChapter) {
      ids.forEach((id) => onDeleteChapter(id));
    }
    showToast(`${ids.length} capítulo(s) excluído(s) em massa.`);
    setSelectedChapterIds(new Set());
    setIsBulkSelectMode(false);
  };

  // Clear all chapters
  const handleConfirmClearAll = () => {
    if (onClearAllChapters) {
      onClearAllChapters();
    } else if (onDeleteChapters) {
      onDeleteChapters(chapters.map((c) => c.id));
    }
    setIsClearAllModalOpen(false);
    setSelectedChapterIds(new Set());
    setIsBulkSelectMode(false);
    setChapterPanels({});
    showToast('Todos os capítulos foram limpos do projeto.');
  };

  // Sort chapters
  const handleApplySort = (mode: 'asc' | 'desc' | 'reverse') => {
    if (onSortChapters) {
      onSortChapters(mode);
    }
    if (mode === 'asc') setSortDirection('asc');
    else if (mode === 'desc') setSortDirection('desc');
    else setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));

    setIsSortDropdownOpen(false);
    showToast(
      mode === 'asc'
        ? 'Capítulos ordenados de 1 a N (Crescente)'
        : mode === 'desc'
        ? 'Capítulos ordenados de N a 1 (Decrescente)'
        : 'Ordem dos capítulos invertida'
    );
  };

  // Fit single panel or selected panel to 100% full width of page
  const handleFitPanelToFullWidth = useCallback(
    (panelId?: string | null) => {
      const targetId = panelId || selectedPanelId;
      const natW = naturalDimensions.width || 704;
      if (!targetId) return;

      const next = {
        ...cropBox,
        x: 0,
        width: natW,
      };
      setCropBox(next);
      syncPanelCoords(targetId, next);
      showToast('↔️ Quadro ajustado para 100% da largura');
    },
    [selectedPanelId, naturalDimensions.width, cropBox, syncPanelCoords, showToast]
  );

  // Fit all detected panels on current page to 100% full width
  const handleFitAllPanelsToFullWidth = useCallback(() => {
    const natW = naturalDimensions.width || 704;
    setChapterPanels((prev) => {
      const chap = prev[currentChapterId] || {};
      const pagePanels = chap[currentPageNumber] || [];
      return {
        ...prev,
        [currentChapterId]: {
          ...chap,
          [currentPageNumber]: pagePanels.map((p) => ({
            ...p,
            x: 0,
            width: natW,
          })),
        },
      };
    });
    setCropBox((prev) => ({
      ...prev,
      x: 0,
      width: natW,
    }));
    showToast(`↔️ Todos os ${detectedPanels.length} quadros ajustados para 100% de largura!`);
  }, [naturalDimensions.width, currentChapterId, currentPageNumber, detectedPanels.length, showToast]);

  // Add a new manual crop zone to the current page
  const handleAddManualCropZone = () => {
    const natW = naturalDimensions.width || 704;
    const natH = naturalDimensions.height || 1408;
    const count = detectedPanels.length + 1;
    const r = getRatioValue() || 16 / 9;
    const isFullW = isFullWidthMode || selectedRatio === 'Livre';
    const width = isFullW ? natW : Math.min(Math.round(natW * 0.9), 620);
    const height = Math.round(width / r);
    const offsetY = Math.min(natH - height, Math.max(40, (count - 1) * 140 + 60));
    const offsetX = isFullW ? 0 : Math.max(0, Math.round((natW - width) / 2));

    const newId = `crop_manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newPanel: DetectedPanel = {
      id: newId,
      x: offsetX,
      y: offsetY,
      width,
      height,
      confidence: 1.0,
      algorithm: 'manual',
      label: `Zona ${String(count).padStart(2, '0')}`,
      pageWidth: natW,
      pageHeight: natH,
    };

    const updated = [...detectedPanels, newPanel];
    setPageDetectedPanels(currentPageNumber, updated);
    setSelectedPanelId(newId);
    setCropBox({
      x: newPanel.x,
      y: newPanel.y,
      width: newPanel.width,
      height: newPanel.height,
    });
    showToast(`✂️ ${newPanel.label} criada (${width}×${height}px)`);
  };

  // Remove a specific panel / crop zone
  const handleRemovePanel = (panelId: string) => {
    setChapterPanels((prev) => {
      const chap = prev[currentChapterId] || {};
      const pagePanels = chap[currentPageNumber] || [];
      const toRemove = pagePanels.find((p) => p.id === panelId);
      const updated = pagePanels.filter((p) => p.id !== panelId);

      if (selectedPanelId === panelId) {
        if (updated.length > 0) {
          const next = updated[0];
          setSelectedPanelId(next.id);
          setCropBox({
            x: next.x,
            y: next.y,
            width: next.width,
            height: next.height,
          });
        } else {
          setSelectedPanelId(null);
        }
      }

      showToast(`🗑️ ${toRemove?.label || 'Seleção'} removida`);

      return {
        ...prev,
        [currentChapterId]: {
          ...chap,
          [currentPageNumber]: updated,
        },
      };
    });
  };

  // Clear all panels / crop zones on current page
  const handleClearAllPanels = () => {
    setPageDetectedPanels(currentPageNumber, []);
    setSelectedPanelId(null);
    showToast('🗑️ Todas as zonas de corte desta página foram removidas');
  };

  // Crop or update a single specified panel / selection
  const handleCropSinglePanel = async (target: {
    id?: string;
    frameId?: string;
    label?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }) => {
    const img = imageRef.current;
    if (!img) return;

    // Use passed coordinates if valid, otherwise fallback to the current live cropBox
    const cropX = Math.max(0, Math.round(typeof target.x === 'number' ? target.x : cropBox.x));
    const cropY = Math.max(0, Math.round(typeof target.y === 'number' ? target.y : cropBox.y));
    const cropW = Math.max(20, Math.round(typeof target.width === 'number' && target.width > 0 ? target.width : cropBox.width));
    const cropH = Math.max(20, Math.round(typeof target.height === 'number' && target.height > 0 ? target.height : cropBox.height));

    const finalBox = {
      id: target.id,
      frameId: target.frameId,
      label: target.label,
      x: cropX,
      y: cropY,
      width: cropW,
      height: cropH,
    };

    // Synchronize chapterPanels with the updated coordinates
    if (target.id) {
      syncPanelCoords(target.id, { x: cropX, y: cropY, width: cropW, height: cropH });
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (rotationAngle !== 0) {
        ctx.save();
        ctx.translate(cropW / 2, cropH / 2);
        ctx.rotate((rotationAngle * Math.PI) / 180);
        ctx.drawImage(img, cropX, cropY, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
        ctx.restore();
      } else {
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      }

      const blob = await canvasToBlob(canvas, 0.88);
      const url = registerCreatedUrl(URL.createObjectURL(blob));

      playShutterSound();
      setIsCropFlashing(true);
      setTimeout(() => setIsCropFlashing(false), 300);

      const existingFrame = findExistingFrame(finalBox);
      const finalRatio = getClosestAspectRatio(cropW, cropH);

      if (existingFrame) {
        if (existingFrame.src?.startsWith('blob:')) {
          revokeCreatedUrl(existingFrame.src);
        }
        if (onUpdateFrame) {
          onUpdateFrame(existingFrame.id, {
            src: url,
            blob,
            ratio: finalRatio,
            cropRect: { x: cropX, y: cropY, width: cropW, height: cropH },
          });
        } else {
          onRemoveFrame(existingFrame.id);
          const updatedFrame: FrameItem = {
            ...existingFrame,
            src: url,
            blob,
            ratio: finalRatio,
            cropRect: { x: cropX, y: cropY, width: cropW, height: cropH },
          };
          if (onAddFramesBatch) onAddFramesBatch([updatedFrame]);
          else onAddFrame(updatedFrame);
        }
        showToast(`🔄 ${target.label || 'Quadro'} atualizado com novo recorte!`);
      } else {
        const frameNumber = frames.length + 1;
        const label = target.label
          ? (target.label.includes('Pág.') ? target.label : `${target.label} (Pág. ${currentPageNumber})`)
          : `Quadro ${String(frameNumber).padStart(2, '0')}`;
        const newFrame: FrameItem = {
          id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          label,
          src: url,
          blob,
          ratio: finalRatio,
          duration: 5.0,
          chapterId: currentChapterId,
          pageNumber: currentPageNumber,
          panelId: target.id,
          cropRect: { x: cropX, y: cropY, width: cropW, height: cropH },
        };

        if (onAddFramesBatch) {
          onAddFramesBatch([newFrame]);
        } else {
          onAddFrame(newFrame);
        }
        showToast(`✂️ ${newFrame.label} recortado!`);
      }
    } catch (err) {
      console.error('Erro ao recortar painel:', err);
    }
  };

  // Run auto panel detection on current page
  const handleRunAutoDetection = async (algoOverride?: DetectionAlgorithm, autoCropAll = false) => {
    if (!currentImageUrl || chapters.length === 0 || currentChapter.pages <= 0) {
      showToast('⚠️ Carregue uma imagem ou capítulo antes de detectar quadros.');
      return;
    }

    const algo = algoOverride || selectedAlgorithm;
    setIsDetecting(true);

    try {
      const img = await loadImage(currentImageUrl);
      if (img.naturalWidth && img.naturalHeight) {
        setNaturalDimensions({
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      }

      const panels = await detectPanels(img, {
        algorithm: algo,
        gutterThreshold,
        padding: panelPadding,
        minPanelHeight,
        sliceHeight: sahiSliceHeight,
        sliceOverlap: sahiOverlap / 100,
        filterTextBubbles,
        textFilterThreshold,
        fullWidthPanels: isFullWidthMode,
      });

      setIsDetecting(false);

      if (panels.length === 0) {
        showToast('Nenhum quadro detectado nesta página com este algoritmo. Experimente o Modo Híbrido ou ajuste a tolerância da calha.');
        return;
      }

      // Save detected selections for this specific page
      setPageDetectedPanels(currentPageNumber, panels);
      setSelectedPanelId(panels[0].id);

      // Select first panel as active crop box and enable free resize
      setCropBox({
        x: panels[0].x,
        y: panels[0].y,
        width: panels[0].width,
        height: panels[0].height,
      });
      setSelectedRatio('Livre');

      const algoName = ALGORITHM_INFO[algo]?.name || 'Modo Automático';

      if (autoCropAll) {
        await executeCropPanelsList(img, panels);
      } else {
        showToast(
          `✨ ${panels.length} quadro(s) detectado(s) na página ${currentPageNumber} via ${algoName}${
            filterTextBubbles ? ' (com filtro de balões)' : ''
          }!`
        );
      }
    } catch (err) {
      console.error('Erro na detecção automática:', err);
      setIsDetecting(false);
      showToast('⚠️ Erro ao processar imagem para detecção automática.');
    }
  };

  // Helper to crop a list of panels from an image
  const executeCropPanelsList = async (img: HTMLImageElement, panels: DetectedPanel[]) => {
    const panelsToCrop = panels.filter((p) => !isSelectionAlreadyCropped(p));
    if (panelsToCrop.length === 0) {
      showToast('ℹ️ Todas as seleções desta página já foram recortadas anteriormente!');
      return;
    }

    playShutterSound();
    setIsCropFlashing(true);
    setTimeout(() => setIsCropFlashing(false), 300);

    const newFrames: FrameItem[] = [];

    for (let i = 0; i < panelsToCrop.length; i++) {
      const p = panelsToCrop[i];
      try {
        const { blob, url } = await extractPanelToBlobAndUrl(img, p, 0.88);
        const closestRatio = getClosestAspectRatio(p.width, p.height);
        const frameNumber = frames.length + newFrames.length + 1;
        const newFrame: FrameItem = {
          id: `q_auto_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 5)}`,
          label: p.label ? `${p.label} (Pág. ${currentPageNumber})` : `Quadro ${String(frameNumber).padStart(2, '0')}`,
          src: registerCreatedUrl(url),
          blob,
          ratio: closestRatio,
          duration: 5.0,
          chapterId: currentChapterId,
          pageNumber: currentPageNumber,
          panelId: p.id,
          cropRect: { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
        };
        newFrames.push(newFrame);
      } catch (err) {
        console.error('Erro ao recortar painel:', err);
      }
    }

    if (newFrames.length > 0) {
      if (onAddFramesBatch) {
        onAddFramesBatch(newFrames);
      } else {
        newFrames.forEach((f) => onAddFrame(f));
      }
    }

    const skipped = panels.length - newFrames.length;
    if (skipped > 0) {
      showToast(`🎉 ${newFrames.length} novo(s) quadro(s) recortado(s)! (${skipped} já existia(m) nesta página)`);
    } else {
      showToast(`🎉 ${newFrames.length} quadros recortados com sucesso para a timeline!`);
    }
  };

  // Batch DETECT selections across all pages of the current chapter
  const handleBatchDetectChapter = async (algoOverride?: DetectionAlgorithm) => {
    if (chapters.length === 0 || currentChapter.pages <= 0) {
      showToast('⚠️ Adicione um capítulo com páginas antes de executar em lote.');
      return;
    }

    const algo = algoOverride || selectedAlgorithm;
    setIsBatchProcessing(true);
    const total = currentChapter.pages;
    let totalPanelsFound = 0;
    const newPanelsByPage: Record<number, DetectedPanel[]> = {};

    setBatchProgress({ mode: 'detect', current: 1, total, count: 0 });

    for (let pNum = 1; pNum <= total; pNum++) {
      setBatchProgress({ mode: 'detect', current: pNum, total, count: totalPanelsFound });
      try {
        const pageUrl = getPageUrl(pNum);
        if (!pageUrl) continue;

        const img = await loadImage(pageUrl);
        if (pNum === currentPageNumber && img.naturalWidth && img.naturalHeight) {
          setNaturalDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        }

        const panels = await detectPanels(img, {
          algorithm: algo,
          gutterThreshold,
          padding: panelPadding,
          minPanelHeight,
          sliceHeight: sahiSliceHeight,
          sliceOverlap: sahiOverlap / 100,
          filterTextBubbles,
          textFilterThreshold,
        });

        if (panels && panels.length > 0) {
          newPanelsByPage[pNum] = panels;
          totalPanelsFound += panels.length;
        }
      } catch (err) {
        console.error(`Erro ao detectar seleções na página ${pNum}:`, err);
      }
    }

    // Save all page detections to state
    setChapterPanels((prev) => ({
      ...prev,
      [currentChapterId]: {
        ...(prev[currentChapterId] || {}),
        ...newPanelsByPage,
      },
    }));

    // If active page has detected panels, automatically select first panel into cropBox
    if (newPanelsByPage[currentPageNumber] && newPanelsByPage[currentPageNumber].length > 0) {
      const first = newPanelsByPage[currentPageNumber][0];
      setSelectedPanelId(first.id);
      setSelectedRatio('Livre');
      setCropBox({
        x: first.x,
        y: first.y,
        width: first.width,
        height: first.height,
      });
      if (first.pageWidth && first.pageHeight) {
        setNaturalDimensions({
          width: first.pageWidth,
          height: first.pageHeight,
        });
      }
    }

    setIsBatchProcessing(false);
    setIsAutoDetectModalOpen(false);
    playShutterSound();
    const algoName = ALGORITHM_INFO[algo]?.name || 'Projeção';
    showToast(
      `✨ Detecção em lote concluída! ${totalPanelsFound} seleções geradas em ${total} páginas via ${algoName}${
        filterTextBubbles ? ' (com filtro de balões)' : ''
      }!`
    );
  };

  // Crop the CURRENT page's detected panels (respecting any deletions or edits made by the user)
  const handleCropPagePanels = async () => {
    const img = imageRef.current;
    if (!img) {
      showToast('⚠️ Carregue uma imagem antes de recortar.');
      return;
    }

    // If selections already exist on this page, crop ONLY those currently preserved selections!
    if (detectedPanels.length > 0) {
      await executeCropPanelsList(img, detectedPanels);
      return;
    }

    // If no panel zones exist, crop the active manual crop box
    handleExecuteCrop();
  };

  // Batch CROP all detected panels across all pages of the current chapter
  const handleBatchProcessChapter = async () => {
    if (chapters.length === 0 || currentChapter.pages <= 0) {
      showToast('⚠️ Adicione um capítulo com páginas antes de executar em lote.');
      return;
    }

    setIsBatchProcessing(true);
    const total = currentChapter.pages;
    let totalCut = 0;
    const newPanelsByPage: Record<number, DetectedPanel[]> = {};
    const allNewFrames: FrameItem[] = [];

    setBatchProgress({ mode: 'crop', current: 1, total, count: 0 });

    for (let pNum = 1; pNum <= total; pNum++) {
      setBatchProgress({ mode: 'crop', current: pNum, total, count: totalCut });
      try {
        const url = getPageUrl(pNum);
        if (!url) continue;

        const img = await loadImage(url);
        if (pNum === currentPageNumber && img.naturalWidth && img.naturalHeight) {
          setNaturalDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight,
          });
        }

        // Check if this page already has detected panels or was reviewed/edited by user
        const currentChapData = chapterPanelsRef.current[currentChapterId] || {};
        const isCurrentPage = pNum === currentPageNumber;
        const pageAlreadyProcessed = pNum in currentChapData;

        let panels: DetectedPanel[] = [];

        if (isCurrentPage) {
          // On current page, strictly use the live detectedPanels (which reflects any deletions made by the user!)
          panels = detectedPanels;
        } else if (pageAlreadyProcessed) {
          // On other pages that were already detected/reviewed, use the saved panels (respects deletions!)
          panels = currentChapData[pNum] || [];
        } else {
          // Only detect on-the-fly for pages that were NEVER detected yet
          panels = await detectPanels(img, {
            algorithm: selectedAlgorithm,
            gutterThreshold,
            padding: panelPadding,
            minPanelHeight,
            sliceHeight: sahiSliceHeight,
            sliceOverlap: sahiOverlap / 100,
            filterTextBubbles,
            textFilterThreshold,
          });
          if (panels && panels.length > 0) {
            newPanelsByPage[pNum] = panels;
          }
        }

        if (panels && panels.length > 0) {
          const existingForPage = frames.filter((f) => f.chapterId === currentChapterId && f.pageNumber === pNum);
          for (let i = 0; i < panels.length; i++) {
            const p = panels[i];
            const alreadyExists = existingForPage.some((f) => {
              if (p.id && f.panelId && f.panelId === p.id) return true;
              if (f.cropRect) {
                const dx = Math.abs(f.cropRect.x - p.x);
                const dy = Math.abs(f.cropRect.y - p.y);
                const dw = Math.abs(f.cropRect.width - p.width);
                const dh = Math.abs(f.cropRect.height - p.height);
                if (dx <= 12 && dy <= 12 && dw <= 12 && dh <= 12) return true;
              }
              return false;
            });
            if (alreadyExists) continue;

            try {
              const { blob, url: panelUrl } = await extractPanelToBlobAndUrl(img, p, 0.88);
              const closestRatio = getClosestAspectRatio(p.width, p.height);
              totalCut++;
              const newFrame: FrameItem = {
                id: `q_batch_${Date.now()}_p${pNum}_${i}_${Math.random().toString(36).substring(2, 5)}`,
                label: p.label ? `${p.label} (Pág. ${pNum})` : `Quadro ${String(frames.length + totalCut).padStart(2, '0')}`,
                src: registerCreatedUrl(panelUrl),
                blob,
                ratio: closestRatio,
                duration: 5.0,
                chapterId: currentChapterId,
                pageNumber: pNum,
                panelId: p.id,
                cropRect: { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width), height: Math.round(p.height) },
              };
              allNewFrames.push(newFrame);
            } catch (err) {
              console.error(`Erro ao extrair painel da página ${pNum}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`Erro ao recortar página ${pNum}:`, err);
      }
    }

    if (allNewFrames.length > 0) {
      if (onAddFramesBatch) {
        onAddFramesBatch(allNewFrames);
      } else {
        allNewFrames.forEach((f) => onAddFrame(f));
      }
    }

    // Save newly detected panels if any were discovered
    if (Object.keys(newPanelsByPage).length > 0) {
      setChapterPanels((prev) => ({
        ...prev,
        [currentChapterId]: {
          ...(prev[currentChapterId] || {}),
          ...newPanelsByPage,
        },
      }));
    }

    playShutterSound();
    setIsBatchProcessing(false);
    setIsAutoDetectModalOpen(false);
    showToast(`🚀 Processamento em lote concluído! ${totalCut} quadros recortados de ${total} páginas.`);
  };

  // When switching page or chapter, auto-focus cropBox to selected or first detected panel if present
  useEffect(() => {
    const pagePanels = (chapterPanels[currentChapterId] || {})[currentPageNumber];
    if (pagePanels && pagePanels.length > 0) {
      const active = pagePanels.find((p) => p.id === selectedPanelId) || pagePanels[0];
      setSelectedPanelId(active.id);
      setCropBox({
        x: active.x,
        y: active.y,
        width: active.width,
        height: active.height,
      });
      if (active.pageWidth && active.pageHeight) {
        setNaturalDimensions({
          width: active.pageWidth,
          height: active.pageHeight,
        });
      }
    } else {
      setSelectedPanelId(null);
    }
  }, [currentPageNumber, currentChapterId, chapterPanels]);

  // Keep naturalDimensions synced with active image element
  useEffect(() => {
    if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
      setNaturalDimensions({
        width: imageRef.current.naturalWidth,
        height: imageRef.current.naturalHeight,
      });
    }
  }, [currentImageUrl, currentPageNumber]);

  // Auto-scroll timeline to active thumbnail
  useEffect(() => {
    if (activeThumbRef.current) {
      activeThumbRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentPageNumber, currentChapterId]);

  // Spacebar pan and Photoshop CS6 Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      // Auto detect shortcut (Ctrl + Shift + A or W)
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && e.shiftKey) || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleRunAutoDetection();
        return;
      }

      // SPACEBAR HOLD TO PAN
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }

      // Photoshop CS6 Tool Shortcuts
      if (e.key === 'h' || e.key === 'H') {
        setActiveTool('hand');
        showToast('✋ Ferramenta Mão ativada (Arraste para mover a tela)');
      } else if (e.key === 'c' || e.key === 'C') {
        if (e.shiftKey) {
          handleCenterCrop();
        } else {
          setActiveTool('crop');
          showToast('✂️ Ferramenta Corte ativada (Arraste na imagem para criar zonas de corte)');
        }
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('move');
        showToast('↖️ Ferramenta Mover ativada');
      } else if (e.key === 'z' || e.key === 'Z') {
        setActiveTool('zoom');
        showToast('🔍 Ferramenta Zoom ativada (Clique para ampliar, Alt+Clique para reduzir)');
      } else if (e.key === 'g' || e.key === 'G') {
        setShowGrid((prev) => !prev);
      } else if (e.key === 'r' || e.key === 'R') {
        handleRotate();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleFitToScreen();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        setZoomLevel(100);
        setPanOffset({ x: 0, y: 0 });
        showToast('Zoom 100% (Pixels Reais)');
      } else if (e.key === 'ArrowLeft') {
        onSelectPageNumber(Math.max(1, currentPageNumber - 1));
      } else if (e.key === 'ArrowRight') {
        onSelectPageNumber(Math.min(currentChapter.pages, currentPageNumber + 1));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedPanelId) {
          e.preventDefault();
          handleRemovePanel(selectedPanelId);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if ((e.ctrlKey || e.metaKey || e.shiftKey) && detectedPanels.length > 0 && imageRef.current) {
          executeCropPanelsList(imageRef.current, detectedPanels);
        } else {
          handleExecuteCrop();
        }
      } else if (e.key === 'Escape') {
        if (dragMode) {
          setDragMode(null);
          drawingBoxRef.current = null;
          setDrawingBox(null);
        }
      } else if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        applyRatio('16:9');
      } else if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        applyRatio('9:16');
      } else if (e.key === '3' && !e.ctrlKey && !e.metaKey) {
        applyRatio('1:1');
      } else if (e.key === '4' && !e.ctrlKey && !e.metaKey) {
        applyRatio('4:3');
      } else if (e.key === 'w' || e.key === 'W') {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (e.shiftKey) {
            handleFitAllPanelsToFullWidth();
          } else {
            handleFitPanelToFullWidth();
          }
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        setIsShortcutsModalOpen(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    const handleBlur = () => {
      setIsSpacePressed(false);
      setIsPanning(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [currentPageNumber, currentChapter.pages, naturalDimensions, cropBox, selectedPanelId, detectedPanels, dragMode, handleFitPanelToFullWidth, handleFitAllPanelsToFullWidth]);

  // Viewport Pan Pointer Handlers
  const isHandModeActive = isSpacePressed || activeTool === 'hand';

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // If Space is held, Hand tool is active, or middle-click: pan viewport!
    if (isHandModeActive || e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: panOffset.x,
        panY: panOffset.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // If Crop tool is active and left-click on viewport (outside image): start drawing crop box!
    if (activeTool === 'crop' && e.button === 0 && !dragMode && !dragRef.current.isDragging) {
      e.preventDefault();
      const nat = clientToNatural(e.clientX, e.clientY);
      const initialCrop = { ...cropBox };

      dragRef.current = {
        isDragging: true,
        mode: 'draw',
        startX: e.clientX,
        startY: e.clientY,
        crop: initialCrop,
        naturalStart: nat,
      };

      setDragMode('draw');
      setDragStart({
        clientX: e.clientX,
        clientY: e.clientY,
        crop: initialCrop,
        naturalStart: nat,
      });

      const initialDrawBox = {
        x: nat.x,
        y: nat.y,
        width: 0,
        height: 0,
      };
      drawingBoxRef.current = initialDrawBox;
      setDrawingBox(initialDrawBox);

      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const handleViewportPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      const deltaX = e.clientX - panStartRef.current.startX;
      const deltaY = e.clientY - panStartRef.current.startY;
      setPanOffset({
        x: panStartRef.current.panX + deltaX,
        y: panStartRef.current.panY + deltaY,
      });
    }
  };

  const handleViewportPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  // Execute real Crop: extract canvas blob and add or update in frames
  const handleExecuteCrop = async () => {
    const activePanel = detectedPanels.find((p) => p.id === selectedPanelId);
    await handleCropSinglePanel({
      id: activePanel?.id || selectedPanelId || undefined,
      label: activePanel?.label,
      x: cropBox.x,
      y: cropBox.y,
      width: cropBox.width,
      height: cropBox.height,
    });
  };

  // Convert client coordinates to natural image coordinates
  const clientToNatural = (clientX: number, clientY: number) => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = naturalDimensions.width / rect.width;
    const scaleY = naturalDimensions.height / rect.height;

    return {
      x: Math.max(0, Math.min(naturalDimensions.width, (clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(naturalDimensions.height, (clientY - rect.top) * scaleY)),
    };
  };

  // Pointer Down for Move or Resize Handles
  const handlePointerDown = (
    e: React.PointerEvent,
    mode: 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'w' | 'e',
    panel?: DetectedPanel
  ) => {
    if (isHandModeActive) return; // Priority to Spacebar / Hand pan
    e.preventDefault();
    e.stopPropagation();

    if (mode !== 'move') {
      setSelectedRatio('Livre');
    }

    let initialCrop = { ...cropBox };
    if (panel) {
      initialCrop = {
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
      };
      if (panel.id !== selectedPanelId) {
        setSelectedPanelId(panel.id);
        setSelectedRatio('Livre');
        setCropBox(initialCrop);
      }
    }

    const nat = clientToNatural(e.clientX, e.clientY);

    dragRef.current = {
      isDragging: true,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      crop: initialCrop,
      naturalStart: nat,
    };

    setDragMode(mode);
    setDragStart({
      clientX: e.clientX,
      clientY: e.clientY,
      crop: initialCrop,
      naturalStart: nat,
    });
  };

  // Pointer Down on Image (Outside Crop Box) -> Start drawing a new crop box or Zoom!
  const handleImagePointerDown = (e: React.PointerEvent) => {
    if (isHandModeActive) return; // Priority to Spacebar / Hand pan

    // If Zoom tool is selected
    if (activeTool === 'zoom') {
      e.preventDefault();
      if (e.altKey) {
        setZoomLevel((z) => Math.max(5, z - 20));
      } else {
        setZoomLevel((z) => Math.min(240, z + 20));
      }
      return;
    }

    if (dragMode || dragRef.current.isDragging) return;
    e.preventDefault();

    const nat = clientToNatural(e.clientX, e.clientY);
    const initialCrop = { ...cropBox };

    dragRef.current = {
      isDragging: true,
      mode: 'draw',
      startX: e.clientX,
      startY: e.clientY,
      crop: initialCrop,
      naturalStart: nat,
    };

    setDragMode('draw');
    setDragStart({
      clientX: e.clientX,
      clientY: e.clientY,
      crop: initialCrop,
      naturalStart: nat,
    });

    const natW = naturalDimensions.width || 704;
    const isFullW = isFullWidthMode && !e.altKey;
    const initialDrawBox = isFullW
      ? {
          x: 0,
          y: nat.y,
          width: natW,
          height: 0,
        }
      : {
          x: nat.x,
          y: nat.y,
          width: 0,
          height: 0,
        };
    drawingBoxRef.current = initialDrawBox;
    setDrawingBox(initialDrawBox);

    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Pointer Move (Handles Drag, Resize, and Draw)
  const handlePointerMove = (e: React.PointerEvent | PointerEvent) => {
    if (isHandModeActive || !dragMode || !imageRef.current) return;

    const img = imageRef.current;
    const rect = img.getBoundingClientRect();
    const scaleX = naturalDimensions.width / rect.width;
    const scaleY = naturalDimensions.height / rect.height;

    const deltaX = (e.clientX - dragStart.clientX) * scaleX;
    const deltaY = (e.clientY - dragStart.clientY) * scaleY;

    const natW = naturalDimensions.width;
    const natH = naturalDimensions.height;
    const orig = dragStart.crop;
    const ratio = getRatioValue();

    if (dragMode === 'draw') {
      const curNat = clientToNatural(e.clientX, e.clientY);
      const startX = dragStart.naturalStart.x;
      const startY = dragStart.naturalStart.y;

      const isFullW = isFullWidthMode && !e.altKey;

      let x1 = isFullW ? 0 : Math.min(startX, curNat.x);
      let y1 = Math.min(startY, curNat.y);
      let w = isFullW ? natW : Math.abs(curNat.x - startX);
      let h = Math.abs(curNat.y - startY);

      if (!isFullW) {
        // Magnetic snap to edges
        const snapMargin = Math.min(30, natW * 0.05);
        if (x1 < snapMargin) {
          w += x1;
          x1 = 0;
        }
        if (x1 + w > natW - snapMargin) {
          w = natW - x1;
        }
      }

      if (ratio && w > 10) {
        h = Math.round(w / ratio);
        if (y1 + h > natH) {
          h = natH - y1;
          w = Math.round(h * ratio);
        }
      }

      const nextBox = {
        x: Math.round(x1),
        y: Math.round(y1),
        width: Math.round(w),
        height: Math.round(h),
      };
      drawingBoxRef.current = nextBox;
      setDrawingBox(nextBox);
      return;
    }

    if (dragMode === 'move') {
      const newX = Math.max(0, Math.min(natW - orig.width, orig.x + deltaX));
      const newY = Math.max(0, Math.min(natH - orig.height, orig.y + deltaY));
      const nextBox = {
        ...orig,
        x: Math.round(newX),
        y: Math.round(newY),
      };
      setCropBox(nextBox);
      if (selectedPanelId) {
        syncPanelCoords(selectedPanelId, nextBox);
      }
      return;
    }

    // Handles Resizing
    let nextX = orig.x;
    let nextY = orig.y;
    let nextW = orig.width;
    let nextH = orig.height;

    // Free resize (selectedRatio === 'Livre' or ratio === null)
    if (!ratio) {
      if (dragMode === 'e') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
      } else if (dragMode === 'w') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextX = potentialX;
      } else if (dragMode === 's') {
        nextH = Math.min(natH - orig.y, Math.max(20, orig.height + deltaY));
      } else if (dragMode === 'n') {
        const potentialY = Math.max(0, Math.min(orig.y + orig.height - 20, orig.y + deltaY));
        nextH = orig.y + orig.height - potentialY;
        nextY = potentialY;
      } else if (dragMode === 'se') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
        nextH = Math.min(natH - orig.y, Math.max(20, orig.height + deltaY));
      } else if (dragMode === 'sw') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextX = potentialX;
        nextH = Math.min(natH - orig.y, Math.max(20, orig.height + deltaY));
      } else if (dragMode === 'ne') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
        const potentialY = Math.max(0, Math.min(orig.y + orig.height - 20, orig.y + deltaY));
        nextH = orig.y + orig.height - potentialY;
        nextY = potentialY;
      } else if (dragMode === 'nw') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextX = potentialX;
        const potentialY = Math.max(0, Math.min(orig.y + orig.height - 20, orig.y + deltaY));
        nextH = orig.y + orig.height - potentialY;
        nextY = potentialY;
      }
    } else {
      // Constrained ratio resize
      if (dragMode === 'e') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
        nextH = Math.round(nextW / ratio);
        if (nextY + nextH > natH) {
          nextH = natH - nextY;
          nextW = Math.round(nextH * ratio);
        }
      } else if (dragMode === 'w') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextH = Math.round(nextW / ratio);
        nextX = potentialX;
        if (nextY + nextH > natH) {
          nextH = natH - nextY;
          nextW = Math.round(nextH * ratio);
          nextX = orig.x + orig.width - nextW;
        }
      } else if (dragMode === 's') {
        nextH = Math.min(natH - orig.y, Math.max(20, orig.height + deltaY));
        nextW = Math.round(nextH * ratio);
        if (nextX + nextW > natW) {
          nextW = natW - nextX;
          nextH = Math.round(nextW / ratio);
        }
      } else if (dragMode === 'n') {
        const potentialY = Math.max(0, Math.min(orig.y + orig.height - 20, orig.y + deltaY));
        nextH = orig.y + orig.height - potentialY;
        nextW = Math.round(nextH * ratio);
        nextY = potentialY;
        if (nextX + nextW > natW) {
          nextW = natW - nextX;
          nextH = Math.round(nextW / ratio);
          nextY = orig.y + orig.height - nextH;
        }
      } else if (dragMode === 'se') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
        nextH = Math.round(nextW / ratio);
        if (nextY + nextH > natH) {
          nextH = natH - nextY;
          nextW = Math.round(nextH * ratio);
        }
      } else if (dragMode === 'sw') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextH = Math.round(nextW / ratio);
        nextX = potentialX;
        if (nextY + nextH > natH) {
          nextH = natH - nextY;
          nextW = Math.round(nextH * ratio);
          nextX = orig.x + orig.width - nextW;
        }
      } else if (dragMode === 'ne') {
        nextW = Math.min(natW - orig.x, Math.max(20, orig.width + deltaX));
        nextH = Math.round(nextW / ratio);
        nextY = orig.y + orig.height - nextH;
        if (nextY < 0) {
          nextY = 0;
          nextH = orig.y + orig.height;
          nextW = Math.round(nextH * ratio);
        }
      } else if (dragMode === 'nw') {
        const potentialX = Math.max(0, Math.min(orig.x + orig.width - 20, orig.x + deltaX));
        nextW = orig.x + orig.width - potentialX;
        nextH = Math.round(nextW / ratio);
        nextX = potentialX;
        nextY = orig.y + orig.height - nextH;
        if (nextY < 0) {
          nextY = 0;
          nextH = orig.y + orig.height;
          nextW = Math.round(nextH * ratio);
          nextX = orig.x + orig.width - nextW;
        }
      }
    }

    let finalNextX = Math.round(nextX);
    let finalNextW = Math.round(nextW);

    // Magnetic snap to image edges when resizing freely
    if (!ratio) {
      const snapMargin = Math.min(30, natW * 0.05);
      if (finalNextX < snapMargin) {
        finalNextW += finalNextX;
        finalNextX = 0;
      }
      if (finalNextX + finalNextW > natW - snapMargin) {
        finalNextW = natW - finalNextX;
      }
    }

    const nextBox = {
      x: finalNextX,
      y: Math.round(nextY),
      width: finalNextW,
      height: Math.round(nextH),
    };
    setCropBox(nextBox);
    if (selectedPanelId) {
      syncPanelCoords(selectedPanelId, nextBox);
    }
  };

  const handlePointerUp = (e: React.PointerEvent | PointerEvent) => {
    dragRef.current = {
      isDragging: false,
      mode: null,
      startX: 0,
      startY: 0,
      crop: { x: 0, y: 0, width: 0, height: 0 },
      naturalStart: { x: 0, y: 0 },
    };

    if (dragMode === 'draw') {
      const finalBox = drawingBoxRef.current || drawingBox;
      if (finalBox && finalBox.width >= 20 && finalBox.height >= 20) {
        const natW = naturalDimensions.width || 704;
        const natH = naturalDimensions.height || 1408;
        const isFullW = isFullWidthMode && !e.altKey;
        const boxX = isFullW ? 0 : finalBox.x;
        const boxW = isFullW ? natW : finalBox.width;

        const nextNum = detectedPanels.length + 1;
        const newId = `crop_manual_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const newPanel: DetectedPanel = {
          id: newId,
          x: boxX,
          y: finalBox.y,
          width: boxW,
          height: finalBox.height,
          confidence: 1.0,
          algorithm: 'manual',
          label: `Zona ${String(nextNum).padStart(2, '0')}`,
          pageWidth: natW,
          pageHeight: natH,
        };

        const updated = [...detectedPanels, newPanel];
        setPageDetectedPanels(currentPageNumber, updated);
        setSelectedPanelId(newId);
        setCropBox({
          x: newPanel.x,
          y: newPanel.y,
          width: newPanel.width,
          height: newPanel.height,
        });
        showToast(`✂️ ${newPanel.label} criada! (${newPanel.width}×${newPanel.height}px)`);
      }
      drawingBoxRef.current = null;
      setDrawingBox(null);
    }

    if (dragMode) {
      try {
        if (e.target && (e.target as HTMLElement).releasePointerCapture) {
          (e.target as HTMLElement).releasePointerCapture((e as any).pointerId);
        }
      } catch {
        // ignore
      }
      setDragMode(null);
    }
  };

  // Global window pointer listeners while dragging/resizing
  useEffect(() => {
    if (!dragMode) return;

    const onGlobalPointerMove = (e: PointerEvent) => {
      handlePointerMove(e);
    };

    const onGlobalPointerUp = (e: PointerEvent) => {
      handlePointerUp(e);
    };

    window.addEventListener('pointermove', onGlobalPointerMove);
    window.addEventListener('pointerup', onGlobalPointerUp);

    return () => {
      window.removeEventListener('pointermove', onGlobalPointerMove);
      window.removeEventListener('pointerup', onGlobalPointerUp);
    };
  }, [dragMode, dragStart, naturalDimensions, selectedRatio, selectedPanelId]);

  // Download single cropped frame
  const handleDownloadSingleFrame = (frame: FrameItem) => {
    const a = document.createElement('a');
    a.href = frame.src;
    a.download = `${frame.label.toLowerCase().replace(/\s+/g, '_')}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Percentage positioning for styling the crop overlay
  const cropPercent = {
    left: (cropBox.x / naturalDimensions.width) * 100,
    top: (cropBox.y / naturalDimensions.height) * 100,
    width: (cropBox.width / naturalDimensions.width) * 100,
    height: (cropBox.height / naturalDimensions.height) * 100,
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-61px)] select-none relative overflow-hidden">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 py-2 font-display text-xs font-bold shadow-xl shadow-primary/20 animate-fade-in border border-primary-foreground/20">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Hidden file input for folder upload */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => e.target.files && onUploadFolder(e.target.files)}
        className="hidden"
      />

      {/* ======================================================== */}
      {/* SLIDING CHAPTERS DRAWER (Clean, Collapsible, Uncluttered) */}
      {/* ======================================================== */}
      {isChaptersDrawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            onClick={() => setIsChaptersDrawerOpen(false)}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs transition-opacity animate-fade-in"
          />
          <div className="relative w-80 max-w-[85vw] bg-[#161720] border-r border-white/10 shadow-2xl flex flex-col justify-between z-10 animate-in slide-in-from-left duration-200">
            <div>
              {/* Header with Title and Add Chapter Button */}
              <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-display text-xs font-bold tracking-widest text-white uppercase">
                    Capítulos ({chapters.length})
                  </p>
                  <p className="text-[10px] text-muted-foreground">Gerenciador de capítulos</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {onAddChapter && (
                    <button
                      onClick={() => onAddChapter()}
                      className="flex items-center gap-1 rounded-lg bg-primary/20 text-primary hover:bg-primary hover:text-primary-foreground px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer"
                      title="Adicionar novo capítulo"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Novo</span>
                    </button>
                  )}
                  <button
                    onClick={() => setIsChaptersDrawerOpen(false)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

          {/* Quick Management Toolbar: Sort & Bulk Actions */}
          {chapters.length > 0 && (
            <div className="px-2.5 py-1.5 border-b border-border/70 bg-background/40 flex items-center justify-between gap-1 text-[11px]">
              {/* Sort Menu / Toggle */}
              <div className="relative">
                <button
                  onClick={() => setIsSortDropdownOpen((prev) => !prev)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded bg-secondary/80 hover:bg-secondary text-foreground text-[11px] font-semibold transition-colors border border-border/50"
                  title="Ordenar capítulos (Crescente, Decrescente, Inverter)"
                >
                  <ArrowUpDown className="h-3 w-3 text-primary" />
                  <span>{sortDirection === 'asc' ? '1→N' : 'N→1'}</span>
                </button>

                {isSortDropdownOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-0 top-7 z-40 w-44 rounded-lg bg-card border border-border shadow-xl p-1 animate-fade-in text-xs"
                  >
                    <button
                      onClick={() => handleApplySort('asc')}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between hover:bg-secondary transition-colors ${
                        sortDirection === 'asc' ? 'text-primary font-bold bg-primary/10' : 'text-foreground'
                      }`}
                    >
                      <span>1 → N (Crescente)</span>
                      {sortDirection === 'asc' && <Check className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => handleApplySort('desc')}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between hover:bg-secondary transition-colors ${
                        sortDirection === 'desc' ? 'text-primary font-bold bg-primary/10' : 'text-foreground'
                      }`}
                    >
                      <span>N → 1 (Decrescente)</span>
                      {sortDirection === 'desc' && <Check className="h-3 w-3" />}
                    </button>
                    <div className="h-[1px] bg-border my-1" />
                    <button
                      onClick={() => handleApplySort('reverse')}
                      className="w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Inverter Ordem Atual</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Bulk Actions: Select Mode & Clear All */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setIsBulkSelectMode((prev) => !prev);
                    setSelectedChapterIds(new Set());
                  }}
                  className={`p-1 rounded transition-colors ${
                    isBulkSelectMode
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                  }`}
                  title={isBulkSelectMode ? 'Sair do modo de seleção' : 'Selecionar capítulos para excluir'}
                >
                  <CheckSquare className="h-3.5 w-3.5" />
                </button>

                <button
                  onClick={() => setIsClearAllModalOpen(true)}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/15 transition-colors font-medium text-[11px]"
                  title="Limpar todos os capítulos em massa"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Limpar</span>
                </button>
              </div>
            </div>
          )}

          {/* Bulk Select Action Bar */}
          {isBulkSelectMode && chapters.length > 0 && (
            <div className="bg-primary/10 border-b border-primary/20 px-2.5 py-1.5 flex items-center justify-between text-xs animate-fade-in">
              <button
                onClick={handleSelectAllChapters}
                className="flex items-center gap-1.5 text-[11px] font-medium text-foreground hover:text-primary transition-colors"
              >
                {selectedChapterIds.size === chapters.length && chapters.length > 0 ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Square className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>Todos ({selectedChapterIds.size}/{chapters.length})</span>
              </button>

              <button
                onClick={handleConfirmBulkDelete}
                disabled={selectedChapterIds.size === 0}
                className="px-2 py-0.5 rounded bg-red-500 text-white font-semibold text-[10px] disabled:opacity-30 disabled:pointer-events-none hover:bg-red-600 transition-colors shadow-xs"
              >
                Excluir ({selectedChapterIds.size})
              </button>
            </div>
          )}

          {/* Chapters List */}
          <div className="p-2 space-y-1">
            {chapters.length === 0 ? (
              <div className="p-4 text-center my-4 space-y-3">
                <div className="w-10 h-10 rounded-full bg-secondary mx-auto flex items-center justify-center text-muted-foreground">
                  <FolderUp className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-foreground">Sem Capítulos</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Nenhum capítulo importado ainda. Carregue sua pasta com as páginas do manhwa.
                  </p>
                </div>
                <div className="pt-2 flex flex-col gap-1.5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <FolderUp className="h-3.5 w-3.5" />
                    <span>Importar Pasta</span>
                  </button>
                  {onAddChapter && (
                    <button
                      onClick={() => onAddChapter()}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>+ Novo Capítulo</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              chapters.map((ch) => {
                const isSelected = ch.id === currentChapterId;
                const isBulkChecked = selectedChapterIds.has(ch.id);
                const pct = Math.round((ch.done / ch.pages) * 100);

                return (
                  <div
                    key={ch.id}
                    onClick={() => {
                      if (isBulkSelectMode) {
                        handleToggleSelectChapter(ch.id);
                      } else {
                        onSelectChapter(ch.id);
                        onSelectPageNumber(1);
                      }
                    }}
                    className={`group relative w-full rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-card border-white/10 text-white shadow-md shadow-black/40 ring-1 ring-white/5'
                        : isBulkChecked
                        ? 'bg-primary/5 border-primary/30 text-white'
                        : 'border-transparent text-muted-foreground hover:bg-white/[0.03] hover:text-white'
                    }`}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_var(--color-primary)]" />
                    )}
                    <div className="flex items-center justify-between gap-1">
                      {isBulkSelectMode && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSelectChapter(ch.id);
                          }}
                          className="mr-1 text-primary focus:outline-none shrink-0"
                        >
                          {isBulkChecked ? (
                            <CheckSquare className="h-4 w-4 text-primary" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}

                      <span
                        className={`truncate text-sm font-semibold flex-1 ${
                          isSelected ? 'text-primary' : 'text-foreground'
                        }`}
                      >
                        {ch.label}
                      </span>

                      {/* Check if fully completed */}
                      {pct === 100 && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-track-audio" />
                      )}

                      {/* Delete Chapter Button */}
                      {!isBulkSelectMode && (
                        <button
                          onClick={(e) => handleRequestDeleteChapter(e, ch)}
                          className="opacity-0 group-hover:opacity-100 hover:opacity-100 p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/15 rounded transition-all shrink-0 ml-1"
                          title={`Excluir ${ch.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center justify-between">
                      <span>{ch.done}/{ch.pages} imagens</span>
                      <span className="font-mono text-[10px]">{pct}%</span>
                    </p>

                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Drag & Drop Import Folder Box */}
        <div className="p-3 border-t border-border/60">
          <button
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsFolderDragging(true); }}
            onDragLeave={() => setIsFolderDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsFolderDragging(false);
              if (e.dataTransfer.files) onUploadFolder(e.dataTransfer.files);
            }}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed py-4 text-xs text-muted-foreground transition-colors ${
              isFolderDragging
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:border-primary hover:text-primary'
            }`}
          >
            <FolderUp className="h-4 w-4" />
            <span className="font-semibold text-[11px]">Importar pasta de capítulos</span>
            <span className="text-[10px] opacity-70">Arraste ou clique</span>
          </button>
        </div>
      </div>
    </div>
)}

      {/* ======================================================== */}
      {/* MAIN WORKSPACE CANVAS: CLEAN FRAMELESS ISLAND VIEWPORT   */}
      {/* ======================================================== */}
      <div className="flex min-w-0 flex-1 flex-col lg:h-[calc(100vh-61px)] bg-[#121319] relative overflow-hidden">
        {/* Top Floating Control Bar (Modeled after modern studio UI in image_02d6ff.png) */}
        <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none select-none">
          {/* Left: Chapter Selector Pill */}
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={() => setIsChaptersDrawerOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#181922]/90 backdrop-blur-xl border border-white/10 hover:border-white/25 text-xs font-semibold text-white shadow-xl transition-all cursor-pointer"
              title="Abrir gaveta de capítulos"
            >
              <FolderUp className="h-3.5 w-3.5 text-primary" />
              <span className="truncate max-w-[130px] font-display">{currentChapter.label}</span>
              <span className="text-[10px] text-muted-foreground font-mono">({currentChapter.pages} pág)</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>

          {/* Center: Slide / Page Navigation Pill (Directly inspired by image_02d6ff.png) */}
          <div className="pointer-events-auto flex items-center gap-1 px-3 py-1.5 rounded-full bg-[#181922]/90 backdrop-blur-xl border border-white/10 shadow-xl text-xs font-semibold text-white">
            <button
              onClick={() => onSelectPageNumber(Math.max(1, currentPageNumber - 1))}
              disabled={currentPageNumber <= 1}
              className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 cursor-pointer transition-colors"
              title="Página anterior (Seta Esquerda)"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-mono text-xs px-2 font-bold">
              Página {currentPageNumber} <span className="text-muted-foreground font-normal">/ {currentChapter.pages}</span>
            </span>
            <button
              onClick={() => onSelectPageNumber(Math.min(currentChapter.pages, currentPageNumber + 1))}
              disabled={currentPageNumber >= currentChapter.pages}
              className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 cursor-pointer transition-colors"
              title="Próxima página (Seta Direita)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Right: Zoom & Quick Tools Pills */}
          <div className="pointer-events-auto flex items-center gap-1.5">
            {/* Zoom Controls Pill */}
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#181922]/90 backdrop-blur-xl border border-white/10 shadow-xl text-xs font-mono text-white">
              <button
                onClick={() => setZoomLevel((z) => Math.max(5, z - 10))}
                className="p-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer"
                title="Diminuir zoom (-)"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center font-semibold text-[11px] text-white/90">{zoomLevel}%</span>
              <button
                onClick={() => setZoomLevel((z) => Math.min(220, z + 10))}
                className="p-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer"
                title="Aumentar zoom (+)"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <div className="h-3 w-[1px] bg-white/15 mx-0.5" />
              <button
                onClick={handleFitToScreen}
                className="p-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                title="Ajustar à tela"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
            </div>

            <button
              onClick={() => {
                setIsFullWidthMode((prev) => {
                  const next = !prev;
                  showToast(next ? '↔️ Largura Total ATIVADA (100% Manhwa)' : '🔓 Modo Largura Livre');
                  return next;
                });
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all shadow-xl cursor-pointer ${
                isFullWidthMode
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-[#181922]/90 border-white/10 text-muted-foreground hover:text-white'
              }`}
              title="Fixar seleções em 100% da largura da imagem (ideal para Manhwa/Webtoon) - Atalho: W"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              <span className="text-[11px] font-mono">100% Largura</span>
            </button>

            <button
              onClick={() => setShowGrid((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all shadow-xl cursor-pointer ${
                showGrid
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-[#181922]/90 border-white/10 text-muted-foreground hover:text-white'
              }`}
              title="Grade dos Terços (G)"
            >
              <Grid className="h-3.5 w-3.5" />
              <span className="text-[11px] font-mono">Grade</span>
            </button>

            <button
              onClick={() => setIsShortcutsModalOpen(true)}
              className="p-2 rounded-full bg-[#181922]/90 border border-white/10 text-muted-foreground hover:text-white shadow-xl transition-all cursor-pointer"
              title="Atalhos de Teclado"
            >
              <Keyboard className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Floating Left Tools Island (Directly modeled after vertical toolbar in image_02d6ff.png) */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 p-1.5 rounded-2xl bg-[#181922]/92 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/60 select-none">
          <button
            onClick={() => setActiveTool('move')}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              activeTool === 'move'
                ? 'bg-white/15 text-white shadow-sm ring-1 ring-white/20'
                : 'text-muted-foreground hover:text-white hover:bg-white/5'
            }`}
            title="Mover Enquadramento (V)"
          >
            <Move className="h-4 w-4" />
          </button>

          <button
            onClick={() => setActiveTool('crop')}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              activeTool === 'crop'
                ? 'bg-primary text-primary-foreground shadow-md shadow-primary/30'
                : 'text-muted-foreground hover:text-white hover:bg-white/5'
            }`}
            title="Corte Demarcado (C)"
          >
            <Crop className="h-4 w-4 stroke-[2.5]" />
          </button>

          <button
            onClick={() => setActiveTool('hand')}
            onDoubleClick={handleFitToScreen}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              activeTool === 'hand' || isSpacePressed
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-muted-foreground hover:text-white hover:bg-white/5'
            }`}
            title="Mão / Pan (H ou Segure Espaço · Duplo clique ajusta à tela)"
          >
            <Hand className="h-4 w-4" />
          </button>

          <button
            onClick={() => setActiveTool('zoom')}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              activeTool === 'zoom'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-muted-foreground hover:text-white hover:bg-white/5'
            }`}
            title="Zoom (Z)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <div className="h-[1px] w-4 bg-white/10 my-0.5" />

          <button
            onClick={handleRotate}
            className="p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-white/5 transition-all cursor-pointer"
            title="Girar Orientação 90° (R)"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          <button
            onClick={handleCenterCrop}
            className="p-2 rounded-xl text-muted-foreground hover:text-white hover:bg-white/5 transition-all cursor-pointer"
            title="Centralizar Enquadramento (Shift+C)"
          >
            <Crosshair className="h-4 w-4" />
          </button>

          <button
            onClick={() => {
              setIsFullWidthMode((prev) => {
                const next = !prev;
                showToast(next ? '↔️ Largura Total ATIVADA (100%)' : '🔓 Modo Largura Livre');
                return next;
              });
            }}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              isFullWidthMode
                ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                : 'text-muted-foreground hover:text-white hover:bg-white/5'
            }`}
            title={isFullWidthMode ? 'Largura Total ativa (100% da imagem). Clique para livre.' : 'Ativar Largura Total (100% da imagem)'}
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
        </div>

          {/* Checkerboard Viewport */}
          <div
            ref={viewportRef}
            onPointerDown={handleViewportPointerDown}
            onPointerMove={handleViewportPointerMove}
            onPointerUp={handleViewportPointerUp}
            className={`checker-bg flex-1 min-h-0 overflow-hidden p-6 relative select-none flex items-center justify-center ${
              isHandModeActive
                ? isPanning
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
                : activeTool === 'zoom'
                ? 'cursor-zoom-in'
                : 'cursor-default'
            }`}
          >
            {chapters.length === 0 || !currentImageUrl || currentChapter.pages === 0 ? (
              <div className="text-center p-8 max-w-md bg-card/90 backdrop-blur rounded-xl border border-border shadow-2xl space-y-4 my-auto animate-fade-in">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <FolderUp className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-foreground">
                    {chapters.length === 0 ? 'Nenhum Capítulo Carregado' : 'Capítulo Sem Páginas'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {chapters.length === 0
                      ? 'Importe uma pasta com as imagens dos seus capítulos de manhwa para começar os cortes e a detecção automática.'
                      : `O capítulo "${currentChapter.label}" ainda não possui páginas. Importe imagens para começar.`}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full sm:w-auto px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity shadow"
                  >
                    <FolderUp className="h-4 w-4" />
                    <span>Importar Pasta de Capítulos</span>
                  </button>
                  {onAddChapter && (
                    <button
                      onClick={() => onAddChapter()}
                      className="w-full sm:w-auto px-3 py-2 rounded-md bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Novo Capítulo</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div
                ref={imageContainerRef}
                onPointerDown={handleImagePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                className={`relative inline-block shadow-2xl my-auto ${
                  isHandModeActive
                    ? 'pointer-events-none'
                    : activeTool === 'zoom'
                    ? 'cursor-zoom-in'
                    : activeTool === 'move'
                    ? 'cursor-move'
                    : 'cursor-crosshair'
                }`}
                style={{
                  width: `${(zoomLevel / 100) * 440}px`,
                  transform: `translate3d(${panOffset.x}px, ${panOffset.y}px, 0px)${
                    rotationAngle !== 0 ? ` rotate(${rotationAngle}deg)` : ''
                  }`,
                  transition: isPanning ? 'none' : 'transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* Manhwa Page Artwork */}
                <img
                  ref={imageRef}
                  src={currentImageUrl}
                  onLoad={handleImageLoad}
                  alt="Página do capítulo em recorte"
                  width={704}
                  height={1408}
                  className="w-full h-auto block select-none pointer-events-none rounded shadow-2xl"
                />

                {/* SVG Dark Mask with cutouts for all active selection zones */}
                {detectedPanels.length > 0 && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none rounded overflow-hidden z-10">
                    <defs>
                      <mask id={`multi-crop-mask-${currentChapterId}-${currentPageNumber}`}>
                        <rect width="100%" height="100%" fill="white" />
                        {detectedPanels.map((p) => {
                          const baseW = p.pageWidth || naturalDimensions.width || 704;
                          const baseH = p.pageHeight || naturalDimensions.height || 1408;
                          const isCurr = p.id === selectedPanelId;
                          const liveX = isCurr ? cropBox.x : p.x;
                          const liveY = isCurr ? cropBox.y : p.y;
                          const liveW = isCurr ? cropBox.width : p.width;
                          const liveH = isCurr ? cropBox.height : p.height;

                          // Subpixel & edge tolerance: if within 2px of edges, snap cut to exact 0% and 100%
                          const isLeftEdge = liveX <= 2;
                          const isRightEdge = (liveX + liveW) >= (baseW - 2);
                          const svgX = isLeftEdge ? '0%' : `${(liveX / baseW) * 100}%`;
                          const svgW = (isLeftEdge && isRightEdge)
                            ? '100%'
                            : `${((isRightEdge ? (baseW - (isLeftEdge ? 0 : liveX)) : liveW) / baseW) * 100}%`;

                          return (
                            <rect
                              key={p.id}
                              x={svgX}
                              y={`${(liveY / baseH) * 100}%`}
                              width={svgW}
                              height={`${(liveH / baseH) * 100}%`}
                              fill="black"
                            />
                          );
                        })}
                        {drawingBox && (() => {
                          const baseW = naturalDimensions.width || 704;
                          const baseH = naturalDimensions.height || 1408;
                          const isLeftEdge = drawingBox.x <= 2;
                          const isRightEdge = (drawingBox.x + drawingBox.width) >= (baseW - 2);
                          const svgX = isLeftEdge ? '0%' : `${(drawingBox.x / baseW) * 100}%`;
                          const svgW = (isLeftEdge && isRightEdge)
                            ? '100%'
                            : `${((isRightEdge ? (baseW - (isLeftEdge ? 0 : drawingBox.x)) : drawingBox.width) / baseW) * 100}%`;
                          return (
                            <rect
                              x={svgX}
                              y={`${(drawingBox.y / baseH) * 100}%`}
                              width={svgW}
                              height={`${(drawingBox.height / baseH) * 100}%`}
                              fill="black"
                            />
                          );
                        })()}
                      </mask>
                    </defs>
                    <rect
                      width="100%"
                      height="100%"
                      fill="rgba(0, 0, 0, 0.65)"
                      mask={`url(#multi-crop-mask-${currentChapterId}-${currentPageNumber})`}
                    />
                  </svg>
                )}

                {/* Render ALL Selection Squares */}
                {detectedPanels.map((dp) => {
                  const baseW = dp.pageWidth || naturalDimensions.width || 704;
                  const baseH = dp.pageHeight || naturalDimensions.height || 1408;
                  const isSelected = dp.id === selectedPanelId;
                  const liveX = isSelected ? cropBox.x : dp.x;
                  const liveY = isSelected ? cropBox.y : dp.y;
                  const liveW = isSelected ? cropBox.width : dp.width;
                  const liveH = isSelected ? cropBox.height : dp.height;

                  const isLeftEdge = liveX <= 2;
                  const isRightEdge = (liveX + liveW) >= (baseW - 2);
                  const isFullPageW = isLeftEdge && isRightEdge;

                  const pctX = isLeftEdge ? 0 : (liveX / baseW) * 100;
                  const pctY = (liveY / baseH) * 100;
                  const pctW = isFullPageW ? 100 : (liveW / baseW) * 100;
                  const pctH = (liveH / baseH) * 100;

                  if (isSelected) {
                    return (
                      <div
                        key={dp.id}
                        onPointerDown={(e) => handlePointerDown(e, 'move')}
                        className={`absolute border-2 border-primary cursor-move select-none transition-shadow z-30 ${
                          isCropFlashing
                            ? 'ring-4 ring-primary shadow-[0_0_25px_oklch(78%_0.16_62)] scale-[1.01]'
                            : 'shadow-[0_0_0_1px_rgba(0,0,0,0.8),0_4px_16px_rgba(0,0,0,0.4)]'
                        }`}
                        style={{
                          left: `${pctX}%`,
                          top: `${pctY}%`,
                          width: `${pctW}%`,
                          height: `${pctH}%`,
                        }}
                      >
                        {/* Floating Action Pill above top edge - NEVER collides with corner handles */}
                        {(() => {
                          const matchingFrameForDp = pageFrames.find((f) => f.panelId === dp.id || f.id === dp.id) ||
                            unifiedItems.find((it) => it.panelId === dp.id || it.id === dp.id)?.frame;
                          const isAlreadyCut = isSelectionAlreadyCropped(dp) || Boolean(matchingFrameForDp);
                          return (
                            <div 
                              onPointerDown={(e) => e.stopPropagation()}
                              className="absolute -top-7 left-0 flex items-center gap-1.5 bg-[#14161b]/95 backdrop-blur-md border border-primary/40 px-2 py-0.5 rounded shadow-xl pointer-events-auto z-40 select-none whitespace-nowrap"
                            >
                              <span className="text-[10px] font-bold text-primary">{dp.label}</span>
                              <span className="text-[9px] font-mono text-muted-foreground">{Math.round(cropBox.width)}×{Math.round(cropBox.height)}px</span>
                              {isAlreadyCut && (
                                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/20 px-1 py-0.2 rounded border border-emerald-500/30">
                                  ✓ Recortado
                                </span>
                              )}
                              <div className="h-3 w-[1px] bg-border/60 mx-0.5" />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFitPanelToFullWidth(dp.id);
                                }}
                                className="p-0.5 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                                title="Ajustar para largura total (100% da imagem) - Atalho: W"
                              >
                                <ArrowRightLeft className="h-3 w-3 stroke-[2.5]" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCropSinglePanel({
                                    id: dp.id,
                                    frameId: matchingFrameForDp?.id,
                                    label: dp.label,
                                    x: cropBox.x,
                                    y: cropBox.y,
                                    width: cropBox.width,
                                    height: cropBox.height,
                                  });
                                }}
                                className={`p-0.5 rounded transition-colors cursor-pointer ${
                                  isAlreadyCut
                                    ? 'hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300'
                                    : 'hover:bg-primary/20 text-muted-foreground hover:text-primary'
                                }`}
                                title={isAlreadyCut ? 'Atualizar recorte deste quadro com o novo enquadramento' : 'Recortar esta seleção individual'}
                              >
                                <Check className="h-3 w-3 stroke-[2.5]" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemovePanel(dp.id);
                                }}
                                className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-colors cursor-pointer"
                                title="Remover esta seleção (Del ou Backspace)"
                              >
                                <X className="h-3 w-3 stroke-[2.5]" />
                              </button>
                            </div>
                          );
                        })()}

                        {/* 3x3 Composition Grid (Rule of Thirds) - subtle lines */}
                        {showGrid && (
                          <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-30">
                            {Array.from({ length: 9 }).map((_, i) => (
                              <div key={i} className="border border-primary/30" />
                            ))}
                          </div>
                        )}

                        {/* Corner Handles with enlarged hit area */}
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'nw')}
                          className="absolute h-3 w-3 rounded-xs bg-primary -top-1.5 -left-1.5 cursor-nwse-resize shadow-md ring-1 ring-background z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Noroeste)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'ne')}
                          className="absolute h-3 w-3 rounded-xs bg-primary -top-1.5 -right-1.5 cursor-nesw-resize shadow-md ring-1 ring-background z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Nordeste)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'sw')}
                          className="absolute h-3 w-3 rounded-xs bg-primary -bottom-1.5 -left-1.5 cursor-nesw-resize shadow-md ring-1 ring-background z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Sudoeste)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'se')}
                          className="absolute h-3 w-3 rounded-xs bg-primary -bottom-1.5 -right-1.5 cursor-nwse-resize shadow-md ring-1 ring-background z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Sudeste)"
                        />

                        {/* Edge Handles with enlarged hit area */}
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'n')}
                          className="absolute h-1.5 w-6 rounded-xs bg-primary/90 top-[-3px] left-1/2 -translate-x-1/2 cursor-ns-resize shadow z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Topo)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 's')}
                          className="absolute h-1.5 w-6 rounded-xs bg-primary/90 bottom-[-3px] left-1/2 -translate-x-1/2 cursor-ns-resize shadow z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Base)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'w')}
                          className="absolute w-1.5 h-6 rounded-xs bg-primary/90 left-[-3px] top-1/2 -translate-y-1/2 cursor-ew-resize shadow z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Esquerda)"
                        />
                        <span
                          onPointerDown={(e) => handlePointerDown(e, 'e')}
                          className="absolute w-1.5 h-6 rounded-xs bg-primary/90 right-[-3px] top-1/2 -translate-y-1/2 cursor-ew-resize shadow z-20 after:absolute after:-inset-1.5 after:content-['']"
                          title="Redimensionar (Direita)"
                        />
                      </div>
                    );
                  }

                  // Inactive selection square - clean, unpolluted, transparent, immediate click-to-drag
                  return (
                    <div
                      key={dp.id}
                      onPointerDown={(e) => handlePointerDown(e, 'move', dp)}
                      className="absolute border border-dashed border-white/60 hover:border-primary hover:bg-primary/5 transition-all cursor-move group z-20"
                      style={{
                        left: `${pctX}%`,
                        top: `${pctY}%`,
                        width: `${pctW}%`,
                        height: `${pctH}%`,
                      }}
                      title={`Clique ou arraste para selecionar ${dp.label}`}
                    >
                      {/* Subtle corner tag with label and remove button */}
                      <div 
                        onPointerDown={(e) => e.stopPropagation()}
                        className="absolute top-1 left-1 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-mono text-white/90 border border-white/10 shadow select-none group-hover:border-primary/50"
                      >
                        <span>{dp.label}</span>
                        <span className="opacity-50 font-mono text-[8px]">{Math.round(dp.width)}×{Math.round(dp.height)}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePanel(dp.id);
                          }}
                          className="ml-0.5 p-0.5 hover:text-red-400 rounded transition-colors cursor-pointer"
                          title={`Remover ${dp.label}`}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Drawing Box Preview during Tool C drag */}
                {drawingBox && (() => {
                  const baseW = naturalDimensions.width || 704;
                  const baseH = naturalDimensions.height || 1408;
                  const isLeftEdge = drawingBox.x <= 2;
                  const isRightEdge = (drawingBox.x + drawingBox.width) >= (baseW - 2);
                  const isFullPageW = isLeftEdge && isRightEdge;

                  const pctX = isLeftEdge ? 0 : (drawingBox.x / baseW) * 100;
                  const pctY = (drawingBox.y / baseH) * 100;
                  const pctW = isFullPageW ? 100 : (drawingBox.width / baseW) * 100;
                  const pctH = (drawingBox.height / baseH) * 100;

                  return (
                    <div
                      className="absolute border-2 border-primary bg-primary/20 pointer-events-none z-30 ring-2 ring-primary/40 animate-pulse"
                      style={{
                        left: `${pctX}%`,
                        top: `${pctY}%`,
                        width: `${pctW}%`,
                        height: `${pctH}%`,
                      }}
                    >
                      <div className="absolute -top-6 left-0 rounded bg-primary text-primary-foreground px-1.5 py-0.5 font-bold text-[10px] shadow flex items-center gap-1 font-mono whitespace-nowrap">
                        <Crop className="h-2.5 w-2.5" />
                        <span>Nova Zona ({drawingBox.width}×{drawingBox.height}px)</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Clean, Non-Intrusive Floating Indicator if 0 zones on this page */}
                {detectedPanels.length === 0 && !drawingBox && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex items-center gap-2.5 rounded-full bg-[#181a20]/95 border border-border/80 px-4 py-1.5 shadow-2xl backdrop-blur animate-fade-in text-xs text-foreground select-none">
                    <Crop className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-muted-foreground text-[11px]">Nenhuma seleção nesta página</span>
                    <div className="h-3 w-[1px] bg-border/60 mx-1" />
                    <button
                      type="button"
                      onClick={() => handleRunAutoDetection()}
                      className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Detectar (D)</span>
                    </button>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      type="button"
                      onClick={handleAddManualCropZone}
                      className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary cursor-pointer text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Adicionar Zona</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* DOCKED MINIMAL TIMELINE FOOTER (100% Filmstrip)         */}
          {/* ======================================================== */}
          <footer className="h-[74px] shrink-0 border-t border-white/10 bg-[#14151e]/95 backdrop-blur-xl flex items-center px-4 z-20 select-none">
            {/* Sleek Horizontal Filmstrip Timeline Track */}
            {currentChapter.pages > 0 && (
              <div
                onWheel={(e) => {
                  if (e.deltaY !== 0) {
                    e.currentTarget.scrollLeft += e.deltaY;
                  }
                }}
                className="w-full flex items-center gap-2 overflow-x-auto py-1 px-0.5 scrollbar-none"
              >
                {Array.from({ length: currentChapter.pages }).map((_, idx) => {
                  const pageNum = idx + 1;
                  const isSelected = pageNum === currentPageNumber;
                  const hasFrames = frames.some(
                    (f) => (!f.chapterId || f.chapterId === currentChapterId) && f.pageNumber === pageNum
                  );
                  const pagePanelsCount = (currentChapterPanels[pageNum] || []).length;
                  const thumbUrl = chapterThumbnails[pageNum];

                  return (
                    <button
                      key={pageNum}
                      ref={isSelected ? activeThumbRef : null}
                      onClick={() => onSelectPageNumber(pageNum)}
                      className={`group relative h-[60px] w-[40px] shrink-0 overflow-hidden rounded-lg border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/60 scale-105 shadow-md shadow-primary/25 z-10'
                          : 'border-white/10 opacity-70 hover:opacity-100 hover:border-white/30'
                      }`}
                      title={`Página ${pageNum} (${pagePanelsCount} zonas, ${hasFrames ? 'recortada' : 'não recortada'})`}
                    >
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt={`Página ${pageNum}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="h-full w-full bg-white/[0.04] flex items-center justify-center">
                          <span className="text-[10px] font-mono font-medium text-muted-foreground/60">{pageNum}</span>
                        </div>
                      )}
                      {pagePanelsCount > 0 && (
                        <span className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground text-[8px] font-bold px-1 rounded shadow-xs leading-tight">
                          {pagePanelsCount}
                        </span>
                      )}
                      {hasFrames && (
                        <span className="absolute right-0.5 bottom-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-emerald-500 shadow-xs">
                          <Check className="h-2 w-2 text-white" />
                        </span>
                      )}
                      <span className="absolute top-0.5 left-0.5 bg-black/85 text-[8.5px] font-mono px-1 rounded text-white leading-tight">
                        {pageNum}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </footer>
        </div>

      {/* ======================================================== */}
      {/* COLUMN 3: ENQUADRAMENTO INSPECTOR (320px)                */}
      {/* ======================================================== */}
      <div className="w-full lg:w-[320px] shrink-0 border-t border-border bg-[#161720] lg:h-[calc(100vh-61px)] lg:border-t-0 lg:border-l border-white/10 flex flex-col justify-between overflow-y-auto z-10">
        <div>
          <div className="border-b border-white/10 px-4 py-3 flex items-center justify-between">
            <p className="font-display text-[11px] font-bold tracking-widest text-white uppercase">
              {inspectorTab === 'manual' ? 'Enquadramento' : 'Auto-Detecção'}
            </p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-primary font-bold shadow-xs">
              {Math.round(cropBox.width)}×{Math.round(cropBox.height)} px
            </span>
          </div>

          {/* Segmented Switch Pills (Modeled after image_02d6ff.png top inspector tabs) */}
          <div className="p-2 border-b border-white/10 bg-black/20">
            <div className="grid grid-cols-2 p-1 rounded-xl bg-card border border-white/10">
              <button
                onClick={() => setInspectorTab('manual')}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  inspectorTab === 'manual'
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Manual
              </button>
              <button
                onClick={() => setInspectorTab('auto')}
                className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  inspectorTab === 'auto'
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Auto-Detecção
              </button>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {/* Automatic Panel Detection Card - Shown in Auto Tab */}
            {inspectorTab === 'auto' && (
              <div className="rounded-xl border border-white/10 bg-card/70 p-3.5 space-y-3.5 backdrop-blur-md shadow-lg shadow-black/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-primary font-bold text-xs">
                    <Wand2 className="h-4 w-4" />
                    <span>Algoritmos de Detecção</span>
                  </div>
                  <button
                    onClick={() => setIsAutoDetectModalOpen(true)}
                    className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 font-semibold"
                    title="Configurações avançadas dos algoritmos"
                  >
                    <SlidersHorizontal className="h-3 w-3" />
                    <span>Ajustes</span>
                  </button>
                </div>

                {/* Algorithm Selector Pills */}
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <button
                    onClick={() => setSelectedAlgorithm('profile')}
                    className={`py-1.5 px-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                      selectedAlgorithm === 'profile'
                        ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                        : 'bg-card border-white/5 text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                    }`}
                    title="Mede variação linha a linha para achar calhas vazias contínuas"
                  >
                    <span>⚡ Projeção</span>
                    {selectedAlgorithm === 'profile' && <Check className="h-3 w-3 text-primary" />}
                  </button>
                  <button
                    onClick={() => setSelectedAlgorithm('morphology')}
                    className={`py-1.5 px-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                      selectedAlgorithm === 'morphology'
                        ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                        : 'bg-card border-white/5 text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                    }`}
                    title="Binariza e dilata traços para extrair molduras retangulares desenhadas"
                  >
                    <span>📐 Morfologia</span>
                    {selectedAlgorithm === 'morphology' && <Check className="h-3 w-3 text-primary" />}
                  </button>
                  <button
                    onClick={() => setSelectedAlgorithm('hybrid')}
                    className={`py-1.5 px-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                      selectedAlgorithm === 'hybrid'
                        ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                        : 'bg-card border-white/5 text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                    }`}
                    title="Combina Projeção de Calhas + Refinamento de Contorno (Recomendado)"
                  >
                    <span>✨ Híbrido (Auto)</span>
                    {selectedAlgorithm === 'hybrid' && <Check className="h-3 w-3 text-primary" />}
                  </button>
                  <button
                    onClick={() => setSelectedAlgorithm('sahi')}
                    className={`py-1.5 px-2 rounded-lg border text-left transition-all flex items-center justify-between cursor-pointer ${
                      selectedAlgorithm === 'sahi'
                        ? 'bg-primary/15 border-primary text-primary font-bold shadow-sm'
                        : 'bg-card border-white/5 text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                    }`}
                    title="Janelas deslizantes com sobreposição para tiras verticais gigantes"
                  >
                    <span>🪟 SAHI</span>
                    {selectedAlgorithm === 'sahi' && <Check className="h-3 w-3 text-primary" />}
                  </button>
                </div>

                <p className="text-[10px] text-muted-foreground/80 leading-tight">
                  {selectedAlgorithm === 'profile' && '⚡ Busca calhas vazias contínuas. Roda em milissegundos.'}
                  {selectedAlgorithm === 'morphology' && '📐 Extrai molduras geométricas e quadros lado a lado.'}
                  {selectedAlgorithm === 'hybrid' && '✨ Fatiamento de calhas com refinamento de bordas.'}
                  {selectedAlgorithm === 'sahi' && '🪟 Blocos sobrepostos para tiras verticais contínuas.'}
                </p>

                {/* Inline Sensitivity Sliders */}
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  <div>
                    <div className="flex justify-between text-[10px] font-semibold text-muted-foreground mb-1">
                      <span>Tolerância da Calha</span>
                      <span className="font-mono text-white">{Math.round(gutterThreshold * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.02"
                      max="0.40"
                      step="0.01"
                      value={gutterThreshold}
                      onChange={(e) => setGutterThreshold(parseFloat(e.target.value))}
                      className="w-full h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[10px] font-semibold text-muted-foreground mb-1">
                      <span>Altura Mínima</span>
                      <span className="font-mono text-white">{minPanelHeight} px</span>
                    </div>
                    <input
                      type="range"
                      min="40"
                      max="600"
                      step="10"
                      value={minPanelHeight}
                      onChange={(e) => setMinPanelHeight(parseInt(e.target.value, 10))}
                      className="w-full h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Text & Speech Bubble Filter Status Pill */}
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-card/60 border border-white/10 text-[10px]">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <ShieldCheck className={`h-3.5 w-3.5 ${filterTextBubbles ? 'text-emerald-400' : 'text-muted-foreground/40'}`} />
                    <span className="font-medium">Filtro de Balões & Texto</span>
                  </div>
                  <button
                    onClick={() => setFilterTextBubbles((prev) => !prev)}
                    className={`px-1.5 py-0.5 rounded font-bold text-[9px] transition-colors cursor-pointer ${
                      filterTextBubbles
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {filterTextBubbles ? 'ATIVO' : 'DESLIGADO'}
                  </button>
                </div>

                {/* Quick Action Buttons */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleRunAutoDetection()}
                      disabled={isDetecting || chapters.length === 0}
                      className="flex-1 py-2 px-2 rounded-xl bg-card hover:bg-white/[0.06] text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 border border-white/10 disabled:opacity-40 cursor-pointer"
                      title="Detectar quadros apenas na página atual"
                    >
                      {isDetecting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span>Detectar Página</span>
                    </button>
                    <button
                      onClick={handleCropPagePanels}
                      disabled={isDetecting || chapters.length === 0}
                      className="flex-1 py-2 px-2 rounded-xl bg-card hover:bg-white/[0.06] text-white text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 border border-white/10 cursor-pointer"
                      title="Recorta os quadros selecionados desta página para a timeline"
                    >
                      <Crop className="h-3.5 w-3.5 text-primary" />
                      <span>Recortar Página</span>
                    </button>
                  </div>

                  {/* Batch Action Buttons Row */}
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleBatchDetectChapter()}
                      disabled={isBatchProcessing || chapters.length === 0}
                      className="flex-1 py-2 px-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-[11px] font-bold transition-all flex items-center justify-center gap-1 disabled:opacity-40 shadow-xs cursor-pointer"
                      title="Detecta e salva as seleções em todas as páginas do capítulo"
                    >
                      {isBatchProcessing && batchProgress.mode === 'detect' ? (
                        <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                      ) : (
                        <Zap className="h-3 w-3 text-amber-400" />
                      )}
                      <span>⚡ Detectar Lote</span>
                    </button>
                    <button
                      onClick={handleBatchProcessChapter}
                      disabled={isBatchProcessing || chapters.length === 0}
                      className="flex-1 py-2 px-2 rounded-xl bg-primary text-primary-foreground text-[11px] font-bold hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-1 disabled:opacity-40 shadow-md shadow-orange-500/20 cursor-pointer"
                      title="Recorta todos os quadros do capítulo para a timeline"
                    >
                      <Layers className="h-3 w-3" />
                      <span>Recortar Lote</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Manual Framing Controls - Shown in Manual Tab */}
            {inspectorTab === 'manual' && (
              <>

          {/* Proporção Selector */}
          <div>
            <p className="mb-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
              <span>Proporção</span>
              <span className="text-[10px] text-muted-foreground/60 font-mono">1 a 4</span>
            </p>
            <div className="grid grid-cols-5 gap-1">
              {RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => applyRatio(ratio)}
                  className={`rounded-lg border py-1.5 text-xs font-bold transition-all ${
                    ratio === selectedRatio
                      ? 'border-primary bg-primary/15 text-primary shadow-sm'
                      : 'border-white/5 bg-card/60 text-muted-foreground hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Manual Dimension Inputs (Width, Height, X, Y) */}
          <div className="space-y-2 pt-2 border-t border-white/10">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1 font-mono tracking-wider">Largura (W)</label>
                <input
                  type="number"
                  min={40}
                  max={naturalDimensions.width}
                  value={Math.round(cropBox.width)}
                  onChange={(e) => {
                    const val = Math.max(40, Math.min(naturalDimensions.width, Number(e.target.value)));
                    const r = getRatioValue();
                    const newH = r ? Math.round(val / r) : cropBox.height;
                    setCropBox((prev) => {
                      const next = { ...prev, width: val, height: newH };
                      if (selectedPanelId) syncPanelCoords(selectedPanelId, next);
                      return next;
                    });
                  }}
                  className="w-full bg-card/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/25 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1 font-mono tracking-wider">Altura (H)</label>
                <input
                  type="number"
                  min={40}
                  max={naturalDimensions.height}
                  value={Math.round(cropBox.height)}
                  onChange={(e) => {
                    const val = Math.max(40, Math.min(naturalDimensions.height, Number(e.target.value)));
                    const r = getRatioValue();
                    const newW = r ? Math.round(val * r) : cropBox.width;
                    setCropBox((prev) => {
                      const next = {
                        ...prev,
                        height: val,
                        width: Math.min(naturalDimensions.width, newW),
                      };
                      if (selectedPanelId) syncPanelCoords(selectedPanelId, next);
                      return next;
                    });
                  }}
                  className="w-full bg-card/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/25 shadow-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1 font-mono tracking-wider">Posição X</label>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, naturalDimensions.width - cropBox.width)}
                  value={Math.round(cropBox.x)}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(naturalDimensions.width - cropBox.width, Number(e.target.value)));
                    setCropBox((prev) => {
                      const next = { ...prev, x: val };
                      if (selectedPanelId) syncPanelCoords(selectedPanelId, next);
                      return next;
                    });
                  }}
                  className="w-full bg-card/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/25 shadow-xs"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1 font-mono tracking-wider">Posição Y</label>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, naturalDimensions.height - cropBox.height)}
                  value={Math.round(cropBox.y)}
                  onChange={(e) => {
                    const val = Math.max(0, Math.min(naturalDimensions.height - cropBox.height, Number(e.target.value)));
                    setCropBox((prev) => {
                      const next = { ...prev, y: val };
                      if (selectedPanelId) syncPanelCoords(selectedPanelId, next);
                      return next;
                    });
                  }}
                  className="w-full bg-card/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/25 shadow-xs"
                />
              </div>
            </div>

            {/* Quick Full-Width Actions (100% Manhwa) */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => handleFitPanelToFullWidth()}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-card/80 border border-white/10 hover:border-primary/50 text-[11px] font-semibold text-muted-foreground hover:text-white transition-all cursor-pointer shadow-xs"
                title="Ajustar o quadro selecionado para 100% da largura da imagem (W)"
              >
                <ArrowRightLeft className="h-3 w-3 text-primary" />
                <span>100% Largura (W)</span>
              </button>
              <button
                type="button"
                onClick={handleFitAllPanelsToFullWidth}
                className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-card/80 border border-white/10 hover:border-primary/50 text-[11px] font-semibold text-muted-foreground hover:text-white transition-all cursor-pointer shadow-xs"
                title="Ajustar todos os quadros da página para 100% da largura da imagem (Shift+W)"
              >
                <Maximize2 className="h-3 w-3 text-primary" />
                <span>Todos 100%</span>
              </button>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="space-y-1.5 pt-1">
            <button
              onClick={handleExecuteCrop}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary hover:bg-[#ff4922] py-2.5 text-xs font-bold text-primary-foreground transition-all shadow-lg shadow-orange-500/25 active:scale-[0.98] cursor-pointer uppercase tracking-wider"
            >
              <Crop className="h-4 w-4 stroke-[2.5]" />
              <span>Recortar quadro ativo (Enter)</span>
            </button>

            {detectedPanels.length > 1 && (
              <button
                onClick={() => {
                  if (imageRef.current) executeCropPanelsList(imageRef.current, detectedPanels);
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-card border border-white/10 py-1.5 text-xs font-bold text-white hover:bg-white/[0.06] hover:border-white/20 active:scale-[0.98] transition-all cursor-pointer shadow-sm"
                title="Recortar todas as zonas de corte desta página (Ctrl + Enter)"
              >
                <Check className="h-3.5 w-3.5 text-primary stroke-[2.5]" />
                <span>Recortar Todas as Zonas ({detectedPanels.length})</span>
              </button>
            )}
          </div>

          {/* Unified Container: Quadros da Página (Zonas + Recortes integrados num único item) */}
          <div className="rounded-xl border border-white/10 bg-card/60 p-2.5 space-y-2 backdrop-blur-md shadow-md shadow-black/20">
            {/* Header: Title + Nova Zona + Limpar */}
            <div className="flex items-center justify-between pb-0.5">
              <div className="flex items-center gap-1.5">
                <Crop className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Quadros da Página ({unifiedItems.length})
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={handleAddManualCropZone}
                  className="px-2 py-0.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Criar nova zona de corte (+)"
                >
                  <Plus className="h-3 w-3" />
                  <span>Nova Zona</span>
                </button>
                {unifiedItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClearAllPanels();
                      pageFrames.forEach((f) => onRemoveFrame(f.id));
                      showToast('🗑️ Quadros e zonas desta página foram limpos');
                    }}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                    title="Remover todos os quadros e zonas desta página"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Unified Cards List */}
            <div className="max-h-[260px] overflow-y-auto pr-1 space-y-1.5">
              {unifiedItems.length === 0 ? (
                <div className="p-4 text-center rounded-lg border border-dashed border-white/10 text-[11px] text-muted-foreground bg-card/30">
                  Nenhum quadro nesta página ainda. Arraste com <strong className="text-white">Corte (C)</strong> ou clique em <strong className="text-white">+ Nova Zona</strong>.
                </div>
              ) : (
                unifiedItems.map((item) => {
                  const isCurr = item.panelId ? item.panelId === selectedPanelId : false;
                  const cleanLabel = item.label.replace(/\s*\(Pág\.\s*\d+\)/i, '').trim();

                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        const targetX = item.x || item.panel?.x || item.frame?.cropRect?.x || 0;
                        const targetY = item.y || item.panel?.y || item.frame?.cropRect?.y || 0;
                        const targetW = item.width || item.panel?.width || item.frame?.cropRect?.width || 620;
                        const targetH = item.height || item.panel?.height || item.frame?.cropRect?.height || 349;

                        if (item.panelId) {
                          setSelectedPanelId(item.panelId);
                        }
                        setSelectedRatio('Livre');
                        const targetBox = {
                          x: targetX,
                          y: targetY,
                          width: targetW,
                          height: targetH,
                        };
                        setCropBox(targetBox);
                        focusCropBox(targetBox);
                      }}
                      className={`group rounded-xl border p-2 transition-all cursor-pointer ${
                        isCurr
                          ? 'bg-primary/10 border-primary shadow-sm shadow-primary/20 ring-1 ring-primary/40'
                          : 'bg-card/70 hover:bg-white/[0.04] border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Left: Thumbnail (or draft crop box) */}
                        {item.isCropped && item.src ? (
                          <img
                            key={item.src}
                            src={item.src}
                            alt={cleanLabel}
                            loading="lazy"
                            width={120}
                            height={80}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.frame) setPreviewFrame(item.frame);
                            }}
                            className="h-10 w-12 shrink-0 rounded-lg object-cover border border-white/10 cursor-pointer hover:opacity-90 hover:ring-2 hover:ring-primary/40 transition-all shadow-xs"
                            title="Clique para ampliar preview"
                          />
                        ) : (
                          <div
                            className="h-10 w-12 shrink-0 rounded-lg bg-white/[0.03] border border-dashed border-white/20 flex flex-col items-center justify-center text-muted-foreground/60 shadow-xs"
                            title="Zona demarcada pendente de recorte"
                          >
                            <Crop className="h-4 w-4 text-primary" />
                            <span className="text-[7.5px] font-mono mt-0.5 opacity-60">Zona</span>
                          </div>
                        )}

                        {/* Middle: Identification, Dimensions & Badges */}
                        <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                isCurr
                                  ? 'bg-primary ring-2 ring-primary/40'
                                  : item.isCropped
                                  ? 'bg-emerald-400'
                                  : 'bg-amber-400'
                              }`}
                            />
                            <span className="truncate text-xs font-semibold text-white">{cleanLabel}</span>
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
                            <span className="opacity-80">{item.width}×{item.height}</span>
                            {item.ratio && (
                              <span className="text-[9px] bg-white/5 border border-white/10 px-1 py-0.2 rounded text-muted-foreground">
                                {item.ratio}
                              </span>
                            )}
                            {item.isCropped ? (
                              <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                                Recortado
                              </span>
                            ) : (
                              <span className="text-[9px] font-semibold text-amber-300 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/20">
                                Pendente
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: Actions Toolbar (Recortar / Download / Delete) */}
                        <div className="flex items-center gap-0.5 shrink-0 ml-1">
                          {/* Recortar / Re-recortar Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.panelId) {
                                setSelectedPanelId(item.panelId);
                              }
                              handleCropSinglePanel({
                                id: item.panelId || item.frameId || item.id,
                                frameId: item.frameId || undefined,
                                label: item.label,
                                x: cropBox.x,
                                y: cropBox.y,
                                width: cropBox.width,
                                height: cropBox.height,
                              });
                            }}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              item.isCropped
                                ? 'text-emerald-400/80 hover:bg-emerald-500/20 hover:text-emerald-300'
                                : 'text-primary hover:bg-primary/20 hover:text-primary-foreground'
                            }`}
                            title={item.isCropped ? 'Recortar novamente com o enquadramento atual' : 'Recortar este quadro'}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>

                          {/* Download Button (available when cropped) */}
                          {item.isCropped && item.frame && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadSingleFrame(item.frame!);
                              }}
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                              title="Baixar este quadro em resolução total"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {/* Delete Button (removes both zone and cropped frame) */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.panelId) handleRemovePanel(item.panelId);
                              if (item.frameId) onRemoveFrame(item.frameId);
                            }}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/15 transition-colors cursor-pointer"
                            title="Excluir quadro e zona de corte"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
              </>
            )}

            {/* Total do projeto summary card */}
            <div className="rounded-xl border border-white/10 bg-card/60 p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-semibold text-white">Total do projeto</p>
              {frames.length} quadros recortados · {chapters.length} capítulos na fila
            </div>
          </div>
        </div>
      </div>

      {/* Frame Preview Lightbox Modal */}
      {previewFrame && (
        <div
          onClick={() => setPreviewFrame(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-2xl w-full bg-card rounded-xl border border-border overflow-hidden shadow-2xl p-4"
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-foreground">{previewFrame.label}</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  Proporção: {previewFrame.ratio} · Duração estimada: {previewFrame.duration}s
                </p>
              </div>
              <button
                onClick={() => setPreviewFrame(null)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-4 flex items-center justify-center bg-black rounded-lg overflow-hidden border border-border">
              <img
                src={previewFrame.src}
                alt={previewFrame.label}
                className="max-h-[60vh] max-w-full object-contain"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => handleDownloadSingleFrame(previewFrame)}
                className="px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Baixar imagem</span>
              </button>
              <button
                onClick={() => setPreviewFrame(null)}
                className="px-3.5 py-1.5 rounded-md bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Delete Chapter */}
      {chapterToDelete && (
        <div
          onClick={() => setChapterToDelete(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-card rounded-xl border border-border overflow-hidden shadow-2xl p-5"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-red-500/15 text-red-400 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Excluir Capítulo?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tem certeza de que deseja remover <strong className="text-foreground">{chapterToDelete.label}</strong> com {chapterToDelete.pages} páginas?
                  Todos os quadros recortados vinculados a este capítulo também serão removidos.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setChapterToDelete(null)}
                className="px-3 py-1.5 rounded-md bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDeleteChapter}
                className="px-3.5 py-1.5 rounded-md bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors shadow-sm"
              >
                Confirmar Exclusão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal to Clear All Chapters / Mock Chapters */}
      {isClearAllModalOpen && (
        <div
          onClick={() => setIsClearAllModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-md w-full bg-card rounded-xl border border-border overflow-hidden shadow-2xl p-5"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-red-500/15 text-red-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Limpar Capítulos em Massa?</h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Tem certeza de que deseja remover os capítulos do projeto? Isso limpa a lista rapidamente para que você possa importar e organizar suas próprias pastas de imagens.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col sm:flex-row justify-end gap-2">
              <button
                onClick={() => setIsClearAllModalOpen(false)}
                className="px-3 py-1.5 rounded-md bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors order-last sm:order-first"
              >
                Cancelar
              </button>

              <button
                onClick={handleConfirmClearAll}
                className="px-3.5 py-1.5 rounded-md bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors shadow-sm"
              >
                Excluir Todos ({chapters.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photoshop CS6 Keyboard Shortcuts Reference Modal */}
      {isShortcutsModalOpen && (
        <div
          onClick={() => setIsShortcutsModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-lg w-full bg-[#181a20] rounded-xl border border-[#2d323c] overflow-hidden shadow-2xl p-5"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#2d323c]">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded bg-primary/20 text-primary">
                  <Keyboard className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-bold text-white font-display">
                  Atalhos de Teclado (Estilo Photoshop CS6)
                </h3>
              </div>
              <button
                onClick={() => setIsShortcutsModalOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-white hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <h4 className="font-bold text-primary uppercase tracking-wider text-[11px] mb-2">
                  Navegação & Pan na Tela
                </h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Mão / Pan da Tela (Arrastar Livre)</span>
                    <kbd className="font-mono text-amber-400 bg-black/60 px-2 py-0.5 rounded border border-amber-400/30">
                      Segure ESPAÇO + Arraste
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Ferramenta Mão</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      H
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Ajustar à Tela (Fit Screen)</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      Ctrl + 0
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Zoom 100% (Pixels Reais)</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      Ctrl + 1
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Ferramenta Zoom</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      Z (Clique ampl. / Alt+Clique red.)
                    </kbd>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-primary uppercase tracking-wider text-[11px] mb-2">
                  Corte & Enquadramento
                </h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Ferramenta de Corte (Criar Múltiplas Zonas)</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      C (Arraste livremente)
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Confirmar e Recortar Zona Ativa</span>
                    <kbd className="font-mono text-emerald-400 bg-black/60 px-2 py-0.5 rounded border border-emerald-400/30">
                      Enter
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Recortar Todas as Zonas da Página</span>
                    <kbd className="font-mono text-emerald-400 bg-black/60 px-2 py-0.5 rounded border border-emerald-400/30">
                      Ctrl + Enter
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Remover Zona de Corte Selecionada</span>
                    <kbd className="font-mono text-red-400 bg-black/60 px-2 py-0.5 rounded border border-red-400/30">
                      Del ou Backspace
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Centralizar Enquadramento</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      Shift + C
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Alternar Grade (Regra dos Terços)</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      G
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Girar Orientação 90°</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      R
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Largura Total 100% (Manhwa/Webtoon)</span>
                    <kbd className="font-mono text-cyan-400 bg-black/60 px-2 py-0.5 rounded border border-cyan-400/30">
                      W (Shift + W p/ todos)
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Proporções Rápidas (16:9, 9:16, 1:1, 4:3)</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      Teclas 1, 2, 3, 4
                    </kbd>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-primary uppercase tracking-wider text-[11px] mb-2">
                  Navegação de Capítulos e Páginas
                </h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Página Anterior / Próxima Página</span>
                    <kbd className="font-mono text-white bg-black/60 px-2 py-0.5 rounded border border-white/20">
                      ← e →
                    </kbd>
                  </div>
                  <div className="flex items-center justify-between p-1.5 rounded bg-[#20232a]">
                    <span className="text-gray-300">Excluir Capítulo</span>
                    <span className="text-muted-foreground text-[11px]">
                      Ícone de lixeira no item do capítulo
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setIsShortcutsModalOpen(false)}
                className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: CORTE AUTOMÁTICO & ALGORITMOS FASE 1              */}
      {/* ======================================================== */}
      {isAutoDetectModalOpen && (
        <div
          onClick={() => setIsAutoDetectModalOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-4xl w-full bg-[#181a20] rounded-2xl border border-[#2d323c] overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-[#2d323c] flex items-center justify-between bg-black/30">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/20 text-primary border border-primary/30">
                  <Wand2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white font-display flex items-center gap-2">
                    <span>Corte Automático por Visão Computacional</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 uppercase tracking-wider">
                      Fase 1
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Fatiamento e detecção automática de quadros para Manhwas, Webtoons e Mangás verticais
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsAutoDetectModalOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                title="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 px-5 pt-3 border-b border-[#2d323c] bg-[#14161b] text-xs">
              <button
                onClick={() => setAutoDetectModalTab('execute')}
                className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-semibold transition-colors ${
                  autoDetectModalTab === 'execute'
                    ? 'border-primary text-primary font-bold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>Execução & Parâmetros</span>
              </button>

              <button
                onClick={() => setAutoDetectModalTab('comparative')}
                className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-semibold transition-colors ${
                  autoDetectModalTab === 'comparative'
                    ? 'border-primary text-primary font-bold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Boxes className="h-3.5 w-3.5" />
                <span>Comparativo Técnico da Fase 1</span>
              </button>

              <button
                onClick={() => setAutoDetectModalTab('guide')}
                className={`flex items-center gap-1.5 pb-2.5 px-3 border-b-2 font-semibold transition-colors ${
                  autoDetectModalTab === 'guide'
                    ? 'border-primary text-primary font-bold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>Qual Caminho Seguir?</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto flex-1 space-y-5 text-xs text-gray-300">
              {/* TAB 1: EXECUÇÃO & PARÂMETROS */}
              {autoDetectModalTab === 'execute' && (
                <div className="space-y-5">
                  {/* Algorithm Selector Cards */}
                  <div>
                    <label className="block text-xs font-bold text-gray-200 mb-2 uppercase tracking-wider">
                      Selecione o Algoritmo de Detecção:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {(['profile', 'morphology', 'sahi', 'hybrid'] as DetectionAlgorithm[]).map((algoKey) => {
                        const info = ALGORITHM_INFO[algoKey];
                        const isSelected = selectedAlgorithm === algoKey;
                        return (
                          <div
                            key={algoKey}
                            onClick={() => setSelectedAlgorithm(algoKey)}
                            className={`p-3 rounded-xl border cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-primary/10 border-primary ring-1 ring-primary shadow-lg'
                                : 'bg-[#1e232d]/60 border-[#2d323c] hover:border-border hover:bg-[#202530]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">{info.name}</span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {info.recommended && (
                                  <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                                    Recomendado
                                  </span>
                                )}
                                {isSelected ? (
                                  <div className="h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                                    <Check className="h-2.5 w-2.5 stroke-[3]" />
                                  </div>
                                ) : (
                                  <div className="h-4 w-4 rounded-full border border-muted-foreground/40" />
                                )}
                              </div>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                              {info.tagline}
                            </p>
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                              <span className="px-1.5 py-0.5 rounded bg-black/40 font-mono text-primary">
                                {info.badge}
                              </span>
                              <span className="truncate">{info.cost}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Parameter Fine Tuning */}
                  <div className="p-4 rounded-xl bg-[#14161b] border border-[#2d323c] space-y-4">
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Calibração de Sensibilidade & Margens</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {/* Gutter Threshold */}
                      <div>
                        <div className="flex justify-between items-center mb-1 text-[11px]">
                          <span className="text-gray-300 font-semibold">Tolerância da Calha:</span>
                          <span className="font-mono text-primary font-bold">{gutterThreshold}</span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={50}
                          value={gutterThreshold}
                          onChange={(e) => setGutterThreshold(Number(e.target.value))}
                          className="w-full accent-primary h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Menor = calhas perfeitas | Maior = aceita degradês
                        </span>
                      </div>

                      {/* Min Panel Height */}
                      <div>
                        <div className="flex justify-between items-center mb-1 text-[11px]">
                          <span className="text-gray-300 font-semibold">Altura Mínima (px):</span>
                          <span className="font-mono text-primary font-bold">{minPanelHeight}px</span>
                        </div>
                        <input
                          type="range"
                          min={30}
                          max={200}
                          step={5}
                          value={minPanelHeight}
                          onChange={(e) => setMinPanelHeight(Number(e.target.value))}
                          className="w-full accent-primary h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Evita recortes de pequenas vinhetas/letras
                        </span>
                      </div>

                      {/* Padding */}
                      <div>
                        <div className="flex justify-between items-center mb-1 text-[11px]">
                          <span className="text-gray-300 font-semibold">Margem de Respiro:</span>
                          <span className="font-mono text-primary font-bold">{panelPadding}px</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={16}
                          value={panelPadding}
                          onChange={(e) => setPanelPadding(Number(e.target.value))}
                          className="w-full accent-primary h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          Padding extra ao redor dos quadros recortados
                        </span>
                      </div>
                    </div>

                    {/* Extra SAHI window controls if SAHI or Hybrid */}
                    {(selectedAlgorithm === 'sahi' || selectedAlgorithm === 'hybrid') && (
                      <div className="pt-3 border-t border-border/40 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <div className="flex justify-between items-center mb-1 text-[11px]">
                            <span className="text-gray-300 font-semibold">Janela do SAHI (Altura):</span>
                            <span className="font-mono text-amber-400 font-bold">{sahiSliceHeight}px</span>
                          </div>
                          <input
                            type="range"
                            min={600}
                            max={2000}
                            step={100}
                            value={sahiSliceHeight}
                            onChange={(e) => setSahiSliceHeight(Number(e.target.value))}
                            className="w-full accent-amber-500 h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Tamanho das fatias verticais para evitar pico de memória
                          </span>
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1 text-[11px]">
                            <span className="text-gray-300 font-semibold">Sobreposição (Overlap):</span>
                            <span className="font-mono text-amber-400 font-bold">{sahiOverlap}%</span>
                          </div>
                          <input
                            type="range"
                            min={15}
                            max={40}
                            step={5}
                            value={sahiOverlap}
                            onChange={(e) => setSahiOverlap(Number(e.target.value))}
                            className="w-full accent-amber-500 h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                          />
                          <span className="text-[10px] text-muted-foreground">
                            Área comum entre janelas para fusão de quadros sem corte brusco
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Full Width Manhwa Option */}
                    <div className="pt-3 border-t border-border/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/15 text-primary">
                          <ArrowRightLeft className="h-4 w-4" />
                        </div>
                        <div>
                          <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>Ajustar à Largura Total da Página (100%)</span>
                            <span className="px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono text-[9px] font-bold border border-primary/30">
                              Padrão Webtoon
                            </span>
                          </h5>
                          <p className="text-[10px] text-muted-foreground">
                            Expande os quadros detectados de ponta a ponta na horizontal, eliminando margens e sobras laterais
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => setIsFullWidthMode((prev) => !prev)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                          isFullWidthMode ? 'bg-primary' : 'bg-gray-700'
                        }`}
                        title={isFullWidthMode ? 'Desativar largura total' : 'Ativar largura total'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                            isFullWidthMode ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Morphophotometric Text & Speech Bubble Filter Calibration */}
                    <div className="pt-4 border-t border-border/50 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-400">
                            <ShieldCheck className="h-4 w-4" />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-white flex items-center gap-1.5">
                              <span>Filtro de Balões de Fala e Texto (Pós-Processamento)</span>
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[9px] font-bold border border-emerald-500/30">
                                Morfofotométrico
                              </span>
                            </h5>
                            <p className="text-[10px] text-muted-foreground">
                              Analisa o interior das caixas geradas para descartar balões de fala, onomatopeias e legendas flutuantes
                            </p>
                          </div>
                        </div>

                        {/* Toggle Button */}
                        <button
                          onClick={() => setFilterTextBubbles((prev) => !prev)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                            filterTextBubbles ? 'bg-emerald-500' : 'bg-gray-700'
                          }`}
                          title={filterTextBubbles ? 'Desativar filtro' : 'Ativar filtro'}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              filterTextBubbles ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {filterTextBubbles && (
                        <div className="space-y-3 pt-1">
                          <div>
                            <div className="flex justify-between items-center mb-1 text-[11px]">
                              <span className="text-gray-300 font-semibold">
                                Sensibilidade do Descarte de Balão:
                              </span>
                              <span className="font-mono text-emerald-400 font-bold">
                                {Math.round(textFilterThreshold * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={30}
                              max={85}
                              step={5}
                              value={Math.round(textFilterThreshold * 100)}
                              onChange={(e) => setTextFilterThreshold(Number(e.target.value) / 100)}
                              className="w-full accent-emerald-500 h-1.5 bg-gray-700 rounded-lg cursor-pointer"
                            />
                            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                              <span>Mais Agressivo (descarta mais balões)</span>
                              <span>Padrão (55%)</span>
                              <span>Mais Permissivo</span>
                            </div>
                          </div>

                          {/* 3 Pillars Explanatory Cards */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[10px]">
                            <div className="p-2 rounded-lg bg-[#181c24] border border-[#2d323c]">
                              <span className="font-bold text-gray-200 block mb-0.5">1. CCL Morfométrico</span>
                              <p className="text-muted-foreground leading-tight">
                                Agrupa componentes tipográficos (12 a 450px²) e linhas de texto sem arte contínua.
                              </p>
                            </div>
                            <div className="p-2 rounded-lg bg-[#181c24] border border-[#2d323c]">
                              <span className="font-bold text-gray-200 block mb-0.5">2. Assinatura Fotométrica</span>
                              <p className="text-muted-foreground leading-tight">
                                Identifica fundo com brancura &gt; 85% e saturação neutra (típico de balões ovais).
                              </p>
                            </div>
                            <div className="p-2 rounded-lg bg-[#181c24] border border-[#2d323c]">
                              <span className="font-bold text-gray-200 block mb-0.5">3. Score Composto</span>
                              <p className="text-muted-foreground leading-tight">
                                Descarta se não houver componente dominante de arte (&gt; 18% da área).
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detected Panels summary if any */}
                  {detectedPanels.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-400" />
                        <span className="text-amber-200 font-bold">
                          {detectedPanels.length} quadro(s) detectados na página {currentPageNumber}!
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          if (imageRef.current) {
                            executeCropPanelsList(imageRef.current, detectedPanels);
                            setIsAutoDetectModalOpen(false);
                          }
                        }}
                        className="px-3 py-1.5 rounded-md bg-amber-500 text-black font-bold text-xs hover:bg-amber-400 transition-colors flex items-center gap-1.5 shadow"
                      >
                        <Crop className="h-3.5 w-3.5" />
                        <span>Recortar Todos Agora</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: COMPARATIVO TÉCNICO DA FASE 1 */}
              {autoDetectModalTab === 'comparative' && (
                <div className="space-y-4">
                  <p className="text-xs text-muted-foreground">
                    Comparativo oficial dos 3 algoritmos da <strong>Fase 1</strong> e da abordagem híbrida recomendada para o projeto:
                  </p>

                  <div className="overflow-x-auto rounded-xl border border-[#2d323c]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#1e232d] text-white border-b border-[#2d323c]">
                          <th className="p-3 font-bold uppercase tracking-wider text-[11px] text-primary w-28">
                            Critério
                          </th>
                          <th className="p-3 font-bold border-l border-[#2d323c]">
                            1. Projeção de Perfil
                          </th>
                          <th className="p-3 font-bold border-l border-[#2d323c]">
                            2. Contornos e Morfologia
                          </th>
                          <th className="p-3 font-bold border-l border-[#2d323c]">
                            3. SAHI (Janelas)
                          </th>
                          <th className="p-3 font-bold border-l border-[#2d323c] bg-primary/10 text-primary">
                            4. Pipeline Híbrido ✨
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#2d323c]">
                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            O que realmente faz
                          </td>
                          <td className="p-3 text-gray-300">
                            Mede a variação de cor linha por linha para achar calhas vazias contínuas.
                          </td>
                          <td className="p-3 text-gray-300 border-l border-[#2d323c]">
                            Binariza a imagem e dilata traços para fechar e extrair caixas geométricas de painéis.
                          </td>
                          <td className="p-3 text-gray-300 border-l border-[#2d323c]">
                            Fatia a imagem gigante em blocos menores com sobreposição para não estourar memória.
                          </td>
                          <td className="p-3 text-amber-200 border-l border-[#2d323c] bg-primary/5 font-medium">
                            Combina calhas de perfil para blocos e morfologia interna para quadros e molduras.
                          </td>
                        </tr>

                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            Tipo de tecnologia
                          </td>
                          <td className="p-3 text-gray-300 font-mono text-[11px]">
                            Heurística matemática / Álgebra matricial (NumPy / Canvas)
                          </td>
                          <td className="p-3 text-gray-300 font-mono text-[11px] border-l border-[#2d323c]">
                            Visão Computacional Clássica (OpenCV / Sobel / Dilation)
                          </td>
                          <td className="p-3 text-gray-300 font-mono text-[11px] border-l border-[#2d323c]">
                            Orquestrador de inferência (sahi + NMS / IoU)
                          </td>
                          <td className="p-3 text-amber-200 font-mono text-[11px] border-l border-[#2d323c] bg-primary/5">
                            Pipeline em 2 etapas integrada no navegador
                          </td>
                        </tr>

                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            Custo computacional
                          </td>
                          <td className="p-3 text-emerald-400 font-bold">
                            Quase zero (milissegundos na CPU)
                          </td>
                          <td className="p-3 text-emerald-300 border-l border-[#2d323c]">
                            Muito baixo (centenas de ms na CPU)
                          </td>
                          <td className="p-3 text-amber-400 border-l border-[#2d323c]">
                            Moderado a alto (CPU / GPU)
                          </td>
                          <td className="p-3 text-emerald-400 font-bold border-l border-[#2d323c] bg-primary/5">
                            Ultraleve (~20-40ms por página)
                          </td>
                        </tr>

                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            Onde funciona muito bem
                          </td>
                          <td className="p-3 text-gray-300">
                            Manhwas tradicionais com bastante respiro em branco ou preto entre as cenas.
                          </td>
                          <td className="p-3 text-gray-300 border-l border-[#2d323c]">
                            Cenas com molduras retangulares bem visíveis e traços pretos contínuos.
                          </td>
                          <td className="p-3 text-gray-300 border-l border-[#2d323c]">
                            Cenas complexas: tiras gigantes contínuas (&gt; 20.000px), sem estourar RAM.
                          </td>
                          <td className="p-3 text-emerald-300 border-l border-[#2d323c] bg-primary/5 font-semibold">
                            90%+ dos manhwas e mangás com quadros empilhados ou lado a lado.
                          </td>
                        </tr>

                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            Onde falha / Limitações
                          </td>
                          <td className="p-3 text-rose-300/90">
                            Quebra se houver arte contínua de fundo, fumaça ou degradês unindo dois quadros.
                          </td>
                          <td className="p-3 text-rose-300/90 border-l border-[#2d323c]">
                            Falha em painéis abertos (borderless) ou moldura cortada por efeitos de impacto.
                          </td>
                          <td className="p-3 text-rose-300/90 border-l border-[#2d323c]">
                            Requer lógica apurada de fusão NMS e tratamento de bordas sobrepostas.
                          </td>
                          <td className="p-3 text-amber-300/90 border-l border-[#2d323c] bg-primary/5">
                            Cenas artísticas puras sem calha e sem borda exigem ajuste manual.
                          </td>
                        </tr>

                        <tr className="hover:bg-white/5">
                          <td className="p-3 font-semibold text-gray-300 bg-[#161920]">
                            Impacto no projeto
                          </td>
                          <td className="p-3 text-gray-200 font-medium">
                            Resolve 70% dos cortes iniciais de forma imediata e sem dependências pesadas.
                          </td>
                          <td className="p-3 text-gray-200 font-medium border-l border-[#2d323c]">
                            Permite isolar quadros vizinhos que estão no mesmo nível horizontal.
                          </td>
                          <td className="p-3 text-gray-200 font-medium border-l border-[#2d323c]">
                            Garante precisão profissional em imagens gigantes onde a memória é limitada.
                          </td>
                          <td className="p-3 text-primary font-bold border-l border-[#2d323c] bg-primary/5">
                            Solução definitiva: velocidade máxima com alta precisão geométrica.
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: QUAL CAMINHO SEGUIR? */}
              {autoDetectModalTab === 'guide' && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-gradient-to-r from-primary/10 via-[#181a20] to-transparent border border-primary/30">
                    <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span>Roteiro de Decisão e Melhores Práticas</span>
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Como escolher a técnica ideal de acordo com a estrutura da sua tira ou capítulo:
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Step 1 */}
                    <div className="p-4 rounded-xl bg-[#14161b] border border-[#2d323c] flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs">
                            1
                          </span>
                          <h5 className="font-bold text-white text-xs">
                            Abordagem Mais Rápida para Começar
                          </h5>
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed">
                          Utilize a <strong>Projeção Horizontal de Perfil</strong>. Ela roda instantaneamente e quebra as tiras verticais gigantes em blocos manejáveis na grande maioria dos capítulos de manhwa padrão (Webtoon / Kakao).
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2d323c] text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>Ideal para 70% dos casos comuns</span>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="p-4 rounded-xl bg-[#14161b] border border-[#2d323c] flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-6 w-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-xs">
                            2
                          </span>
                          <h5 className="font-bold text-white text-xs">
                            Quando Adicionar Contornos
                          </h5>
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed">
                          Se você perceber que <strong>dois quadros estão lado a lado na mesma altura</strong> ou que a projeção isolou o bloco vertical mas deixou margens irregulares, ative <strong>Contornos e Morfologia</strong> ou use o <strong>Modo Híbrido</strong>.
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2d323c] text-[11px] text-blue-400 font-medium flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>Quadros múltiplos e molduras pretas</span>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="p-4 rounded-xl bg-[#14161b] border border-[#2d323c] flex flex-col justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="h-6 w-6 rounded-full bg-amber-500/20 text-amber-400 font-bold flex items-center justify-center text-xs">
                            3
                          </span>
                          <h5 className="font-bold text-white text-xs">
                            Quando Migrar para SAHI
                          </h5>
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed">
                          Use o modo <strong>SAHI (Janelas Deslizantes)</strong> quando a imagem vertical for gigantesca (acima de 15.000px ou 30.000px de altura contínua), garantindo que ela seja fatiada em blocos sobrepostos sem estourar a memória da aba.
                        </p>
                      </div>
                      <div className="mt-4 pt-3 border-t border-[#2d323c] text-[11px] text-amber-400 font-medium flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        <span>Imagens ultra-altas sem crash de RAM</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer Actions */}
            <div className="p-4 sm:p-5 border-t border-[#2d323c] bg-[#14161b] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <kbd className="px-1.5 py-0.5 rounded bg-black/60 font-mono text-gray-300 border border-border">
                  W
                </kbd>
                <span>ou</span>
                <kbd className="px-1.5 py-0.5 rounded bg-black/60 font-mono text-gray-300 border border-border">
                  Ctrl+Shift+A
                </kbd>
                <span>para atalho rápido</span>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setIsAutoDetectModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-secondary text-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors"
                >
                  Fechar
                </button>

                <button
                  onClick={() => {
                    handleRunAutoDetection(selectedAlgorithm, false);
                    setIsAutoDetectModalOpen(false);
                  }}
                  disabled={isDetecting || chapters.length === 0}
                  className="px-3.5 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-foreground text-xs font-bold transition-colors flex items-center gap-1.5 border border-border disabled:opacity-40"
                >
                  {isDetecting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-primary" />
                  )}
                  <span>Detectar nesta Página</span>
                </button>

                <button
                  onClick={() => {
                    handleCropPagePanels();
                    setIsAutoDetectModalOpen(false);
                  }}
                  disabled={isDetecting || chapters.length === 0}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-md disabled:opacity-40"
                  title="Recorta os quadros selecionados desta página para a timeline"
                >
                  <Crop className="h-4 w-4" />
                  <span>Recortar Selecionados ({detectedPanels.length})</span>
                </button>

                <button
                  onClick={() => {
                    handleBatchDetectChapter(selectedAlgorithm);
                  }}
                  disabled={isBatchProcessing || chapters.length === 0}
                  className="px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-40"
                  title="Detecta e salva as seleções de enquadramento em todas as páginas do capítulo"
                >
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span>⚡ Detectar em Lote ({currentChapter.pages} págs)</span>
                </button>

                <button
                  onClick={handleBatchProcessChapter}
                  disabled={isBatchProcessing || chapters.length === 0}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-colors flex items-center gap-1.5 shadow-md disabled:opacity-40"
                  title="Executa corte automático em todas as páginas do capítulo para a timeline"
                >
                  <Layers className="h-4 w-4" />
                  <span>Recortar Capítulo Inteiro (Lote)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Processing Overlay */}
      {isBatchProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xs p-4 animate-fade-in">
          <div className="max-w-md w-full bg-[#181a20] rounded-2xl border border-primary/50 shadow-2xl p-6 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-4" />
            <h3 className="text-base font-bold text-white mb-1">
              {batchProgress.mode === 'detect'
                ? '⚡ Detectando Seleções em Lote...'
                : '✂️ Processando Capítulo em Lote...'}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              {batchProgress.mode === 'detect'
                ? `Analisando calhas e gerando seleções com o algoritmo ${ALGORITHM_INFO[selectedAlgorithm]?.name || 'Projeção'}`
                : `Executando corte automático página a página com o algoritmo ${ALGORITHM_INFO[selectedAlgorithm]?.name || 'Projeção'}`}
            </p>

            {/* Progress Bar */}
            <div className="w-full bg-[#202530] h-3 rounded-full overflow-hidden mb-2 border border-border/40">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${(batchProgress.current / Math.max(1, batchProgress.total)) * 100}%`,
                }}
              />
            </div>

            <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
              <span>Página {batchProgress.current} de {batchProgress.total}</span>
              <span className="text-emerald-400 font-bold">
                {batchProgress.count} {batchProgress.mode === 'detect' ? 'seleções identificadas' : 'quadros recortados'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
