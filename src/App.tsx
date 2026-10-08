import React, { useState, useEffect } from 'react';
import { StudioShell } from './components/StudioShell';
import { RecorteView } from './components/RecorteView';
import { RoteiroView } from './components/RoteiroView';
import { NarracaoView } from './components/NarracaoView';
import { MontagemView } from './components/MontagemView';
import { ExportModal } from './components/ExportModal';
import {
  ChapterItem,
  FrameItem,
  SceneItem,
  StudioTab,
  TransitionType,
  ProjectMetadata,
  ChapterMetadata,
  PageScriptState,
} from './types';
import { DetectedPanel } from './utils/panelDetection';
import {
  saveProject,
  loadProject,
  clearProject,
} from './utils/projectStorage';
import {
  FolderUp,
  Wand2,
  Play,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Save,
  Trash2,
  Database,
  RefreshCw,
} from 'lucide-react';

const DEMO_CHAPTERS: ChapterItem[] = [
  {
    id: 'chap_demo_01',
    label: 'Capítulo 01 — O Covil das Sombras',
    pages: 1,
    done: 3,
    imageUrls: ['/assets/page-01.jpg'],
  },
];

const DEMO_FRAMES: FrameItem[] = [
  {
    id: 'f_demo_1',
    label: 'Quadro 01 · Confronto Sombrio',
    src: '/assets/panel-fight.jpg',
    ratio: '16:9',
    duration: 4,
    chapterId: 'chap_demo_01',
    pageNumber: 1,
  },
  {
    id: 'f_demo_2',
    label: 'Quadro 02 · Olhar do Caçador',
    src: '/assets/panel-face.jpg',
    ratio: '16:9',
    duration: 5,
    chapterId: 'chap_demo_01',
    pageNumber: 1,
  },
  {
    id: 'f_demo_3',
    label: 'Quadro 03 · Notificação do Sistema',
    src: '/assets/panel-city.jpg',
    ratio: '16:9',
    duration: 4,
    chapterId: 'chap_demo_01',
    pageNumber: 1,
  },
];

const DEMO_SCENES: SceneItem[] = [
  {
    id: 's_demo_1',
    title: 'Cena 01 — O Despertar no Covil',
    frames: [
      DEMO_FRAMES[0],
      DEMO_FRAMES[1],
    ],
    voice: 'Rafael (grave)',
    duration: '0:09',
    text: 'Quando as portas da masmorra dupla se fecharam, ele percebeu que aquele não era um teste comum. O poder que emanava das estátuas ameaçava devorar tudo.',
  },
  {
    id: 's_demo_2',
    title: 'Cena 02 — Despertar do Monarca',
    frames: [
      DEMO_FRAMES[2],
    ],
    voice: 'Vitória (narradora)',
    duration: '0:06',
    text: 'Uma mensagem flutuante brilhou diante de seus olhos: você completou os requisitos secretos para despertar o poder supremo do Monarca das Sombras.',
  },
];

export default function App() {
  const [currentTab, setCurrentTab] = useState<StudioTab>('recorte');
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string>('');
  const [currentPageNumber, setCurrentPageNumber] = useState<number>(1);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [chapterPanels, setChapterPanels] = useState<Record<string, Record<number, DetectedPanel[]>>>({});
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadata>({
    workTitle: '',
    universeLore: '',
    glossary: {},
    characters: [],
  });
  const [chapterMetadata, setChapterMetadata] = useState<Record<string, ChapterMetadata>>({});
  const [pageScripts, setPageScripts] = useState<Record<string, PageScriptState>>({});
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [exportModalFormat, setExportModalFormat] = useState<'mp4' | 'webm' | 'shotcut' | string>('mp4');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Persistence States (IndexedDB)
  const [isHydrating, setIsHydrating] = useState<boolean>(true);
  const [isProjectLoaded, setIsProjectLoaded] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isConfirmClearModalOpen, setIsConfirmClearModalOpen] = useState<boolean>(false);

  // 1. Initial Hydration from IndexedDB on Mount
  useEffect(() => {
    let isMounted = true;
    async function initStorage() {
      try {
        const stored = await loadProject();
        if (!isMounted) return;

        if (stored && (stored.chapters.length > 0 || stored.frames.length > 0 || stored.scenes.length > 0)) {
          setChapters(stored.chapters);
          setFrames(stored.frames);
          setScenes(stored.scenes);
          if (stored.chapterPanels) {
            setChapterPanels(stored.chapterPanels);
          }
          if (stored.currentChapterId) {
            setCurrentChapterId(stored.currentChapterId);
          } else if (stored.chapters.length > 0) {
            setCurrentChapterId(stored.chapters[0].id);
          }
          if (stored.currentPageNumber) {
            setCurrentPageNumber(stored.currentPageNumber);
          }
          if (stored.currentTab) {
            setCurrentTab(stored.currentTab);
          }
          if (stored.projectMetadata) {
            setProjectMetadata(stored.projectMetadata);
          }
          if (stored.chapterMetadata) {
            setChapterMetadata(stored.chapterMetadata);
          }
          if (stored.pageScripts) {
            setPageScripts(stored.pageScripts);
          }
          setLastSavedAt(stored.updatedAt);
          setSaveStatus('saved');
          showToast(`Projeto local restaurado do IndexedDB (${stored.chapters.length} cap, ${stored.frames.length} quadros)!`, 'info');
        } else {
          setSaveStatus('idle');
        }
      } catch (err) {
        console.error('Falha ao restaurar projeto do IndexedDB:', err);
      } finally {
        if (isMounted) {
          setIsHydrating(false);
          setIsProjectLoaded(true);
        }
      }
    }

    initStorage();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Debounced Auto-Save to IndexedDB whenever project state changes
  useEffect(() => {
    if (!isProjectLoaded || isHydrating) return;

    // Skip auto-save if completely blank
    if (chapters.length === 0 && frames.length === 0 && scenes.length === 0 && Object.keys(chapterPanels).length === 0) {
      return;
    }

    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const success = await saveProject({
          chapters,
          frames,
          scenes,
          chapterPanels,
          currentChapterId,
          currentPageNumber,
          currentTab,
          projectMetadata,
          chapterMetadata,
          pageScripts,
        });

        if (success) {
          setSaveStatus('saved');
          setLastSavedAt(Date.now());
        } else {
          setSaveStatus('error');
        }
      } catch (err) {
        console.error('Erro no auto-save IndexedDB:', err);
        setSaveStatus('error');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [chapters, frames, scenes, chapterPanels, currentChapterId, currentPageNumber, currentTab, projectMetadata, chapterMetadata, pageScripts, isProjectLoaded, isHydrating]);

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((curr) => (curr?.text === text ? null : curr));
    }, 3500);
  };

  // Manual Save Trigger
  const handleManualSave = async () => {
    setSaveStatus('saving');
    try {
      const ok = await saveProject({
        chapters,
        frames,
        scenes,
        chapterPanels,
        currentChapterId,
        currentPageNumber,
        currentTab,
        projectMetadata,
        chapterMetadata,
        pageScripts,
      });
      if (ok) {
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
        showToast('Projeto salvo no IndexedDB com sucesso!', 'success');
      } else {
        setSaveStatus('error');
        showToast('Erro ao salvar no IndexedDB.', 'error');
      }
    } catch {
      setSaveStatus('error');
      showToast('Erro ao salvar no IndexedDB.', 'error');
    }
  };

  // Reset / Clear Project from IndexedDB and memory
  const handleClearProjectConfirm = async () => {
    setIsConfirmClearModalOpen(false);
    try {
      await clearProject();
      setChapters([]);
      setFrames([]);
      setScenes([]);
      setChapterPanels({});
      setProjectMetadata({
        workTitle: '',
        universeLore: '',
        glossary: {},
        characters: [],
      });
      setChapterMetadata({});
      setPageScripts({});
      setCurrentChapterId('');
      setCurrentPageNumber(1);
      setSaveStatus('idle');
      setLastSavedAt(null);
      showToast('Projeto limpo! O IndexedDB foi resetado.', 'info');
    } catch (err) {
      console.error('Erro ao limpar:', err);
    }
  };

  const currentChapter = chapters.find((c) => c.id === currentChapterId) || chapters[0] || {
    id: 'empty',
    label: 'Sem Capítulo',
    pages: 0,
    done: 0,
  };

  // Upload folder of chapters
  const handleUploadFolder = (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileArray.length === 0) return;

    // Group files by directory
    const groups: Record<string, File[]> = {};
    for (const f of fileArray) {
      const relPath = (f as any).webkitRelativePath || f.name;
      let chapterName = 'Capítulo 01';
      if (relPath.includes('/')) {
        const parts = relPath.split('/');
        chapterName = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
      }
      if (!groups[chapterName]) groups[chapterName] = [];
      groups[chapterName].push(f);
    }

    // Sort group names naturally (numeric ascending)
    const sortedGroupNames = Object.keys(groups).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    const newChapters: ChapterItem[] = sortedGroupNames.map((name, idx) => {
      const chFiles = groups[name].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const urls = chFiles.map((file) => URL.createObjectURL(file));
      return {
        id: `upload_${Date.now()}_${idx}`,
        label: name,
        pages: chFiles.length,
        done: 0,
        imageUrls: urls,
        files: chFiles,
        pageBlobs: chFiles,
      };
    });

    setChapters((prev) => [...prev, ...newChapters]);
    if (newChapters.length > 0) {
      setCurrentChapterId(newChapters[0].id);
      setCurrentPageNumber(1);
    }
    showToast(`${newChapters.length} capítulo(s) importado(s) com sucesso!`);
  };

  // Add new chapter
  const handleAddChapter = (files?: FileList | File[]) => {
    const nextNum = chapters.length + 1;
    let urls: string[] = [];
    let chFiles: File[] = [];
    if (files) {
      chFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      urls = chFiles.map((file) => URL.createObjectURL(file));
    }

    const newCh: ChapterItem = {
      id: `c_${Date.now()}`,
      label: `Capítulo ${String(nextNum).padStart(2, '0')}`,
      pages: urls.length,
      done: 0,
      imageUrls: urls,
      files: chFiles,
      pageBlobs: chFiles,
    };
    setChapters((prev) => [...prev, newCh]);
    setCurrentChapterId(newCh.id);
    setCurrentPageNumber(1);
    showToast(`Capítulo ${String(nextNum).padStart(2, '0')} criado!`);
  };

  // Delete chapter
  const handleDeleteChapter = (chapterId: string): boolean => {
    const remaining = chapters.filter((c) => c.id !== chapterId);
    setChapters(remaining);
    setFrames((prev) => prev.filter((f) => f.chapterId !== chapterId));

    if (currentChapterId === chapterId) {
      if (remaining.length > 0) {
        setCurrentChapterId(remaining[0].id);
        setCurrentPageNumber(1);
      } else {
        setCurrentChapterId('');
        setCurrentPageNumber(1);
      }
    }
    showToast('Capítulo removido');
    return true;
  };

  // Bulk delete chapters
  const handleDeleteChapters = (ids: string[]) => {
    const idSet = new Set(ids);
    const remaining = chapters.filter((c) => !idSet.has(c.id));
    setChapters(remaining);
    setFrames((prev) => prev.filter((f) => !f.chapterId || !idSet.has(f.chapterId)));

    if (idSet.has(currentChapterId)) {
      if (remaining.length > 0) {
        setCurrentChapterId(remaining[0].id);
        setCurrentPageNumber(1);
      } else {
        setCurrentChapterId('');
        setCurrentPageNumber(1);
      }
    }
    showToast(`${ids.length} capítulos removidos`);
  };

  // Clear all chapters and start fresh
  const handleClearAllChapters = async () => {
    setChapters([]);
    setFrames([]);
    setScenes([]);
    setChapterPanels({});
    setCurrentChapterId('');
    setCurrentPageNumber(1);
    setSaveStatus('idle');
    setLastSavedAt(null);
    try {
      await clearProject();
      localStorage.removeItem('mec_recap_chapters');
      localStorage.removeItem('mec_recap_frames');
      localStorage.removeItem('mec_recap_scenes');
    } catch {}
    showToast('Projeto limpo com sucesso!', 'info');
  };

  // Load demo manhwa project
  const handleLoadDemoProject = () => {
    setChapters(DEMO_CHAPTERS);
    setFrames(DEMO_FRAMES);
    setScenes(DEMO_SCENES);
    setCurrentChapterId(DEMO_CHAPTERS[0].id);
    setCurrentPageNumber(1);
    showToast('Projeto demo de Manhwa carregado!');
  };

  // Sort chapters
  const handleSortChapters = (mode: 'asc' | 'desc' | 'reverse') => {
    setChapters((prev) => {
      if (mode === 'reverse') {
        return [...prev].reverse();
      }
      return [...prev].sort((a, b) => {
        const cmp = a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
        return mode === 'asc' ? cmp : -cmp;
      });
    });
  };

  // Add frame from Recorte
  const handleAddFrame = (newFrame: FrameItem) => {
    setFrames((prev) => [...prev, newFrame]);

    // Update chapter done count
    setChapters((prev) =>
      prev.map((c) => (c.id === currentChapterId ? { ...c, done: Math.min(c.pages, c.done + 1) } : c))
    );

    // Also associate to first scene if available
    setScenes((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: `s_${Date.now()}`,
            title: 'Cena 01 — Nova Cena',
            frames: [newFrame],
            voice: 'Rafael (grave)',
            duration: '0:05',
            text: 'O confronto recém-iniciado revelava os primeiros sinais do despertar das sombras.',
          },
        ];
      }
      return [
        {
          ...prev[0],
          frames: [newFrame, ...prev[0].frames],
        },
        ...prev.slice(1),
      ];
    });

    showToast(`Quadro recortado e adicionado à timeline!`);
  };

  // Remove frame
  const handleRemoveFrame = (id: string) => {
    setFrames((prev) => prev.filter((f) => f.id !== id));
    setScenes((prev) =>
      prev.map((s) => ({
        ...s,
        frames: s.frames.filter((f) => f.id !== id),
      }))
    );
    showToast('Quadro removido da timeline', 'info');
  };

  // Update frame duration
  const handleUpdateFrameDuration = (frameId: string, duration: number) => {
    setFrames((prev) =>
      prev.map((f) => (f.id === frameId ? { ...f, duration } : f))
    );
    setScenes((prev) =>
      prev.map((s) => ({
        ...s,
        frames: s.frames.map((f) => (f.id === frameId ? { ...f, duration } : f)),
      }))
    );
  };

  // Update frame settings (duration, transition, etc.)
  const handleUpdateFrame = (frameId: string, partial: Partial<FrameItem>) => {
    setFrames((prev) =>
      prev.map((f) => (f.id === frameId ? { ...f, ...partial } : f))
    );
    setScenes((prev) =>
      prev.map((s) => ({
        ...s,
        frames: s.frames.map((f) => (f.id === frameId ? { ...f, ...partial } : f)),
      }))
    );
  };

  // Batch update multiple frames (e.g. automatic proportional redistribution or atomic AI scenes)
  const handleUpdateMultipleFrames = (
    updates: { id: string; duration?: number; transition?: TransitionType; narrationSnippet?: string }[]
  ) => {
    const updateMap = new Map(updates.map((u) => [u.id, u]));
    setFrames((prev) =>
      prev.map((f) => (updateMap.has(f.id) ? { ...f, ...updateMap.get(f.id)! } : f))
    );
    setScenes((prev) =>
      prev.map((s) => ({
        ...s,
        frames: s.frames.map((f) => (updateMap.has(f.id) ? { ...f, ...updateMap.get(f.id)! } : f)),
      }))
    );
  };

  const handleUpdateSceneText = (sceneId: string, text: string) => {
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, text } : s))
    );
  };

  const handleUpdateProjectMetadata = (meta: ProjectMetadata) => {
    setProjectMetadata(meta);
  };

  const handleUpdateChapterMetadata = (chapterId: string, meta: ChapterMetadata) => {
    setChapterMetadata((prev) => ({ ...prev, [chapterId]: meta }));
  };

  const handleUpdatePageScript = (key: string, scriptState: PageScriptState) => {
    setPageScripts((prev) => ({ ...prev, [key]: scriptState }));
  };

  const handleUpdateMultiplePageScripts = (updates: Record<string, PageScriptState>) => {
    setPageScripts((prev) => ({ ...prev, ...updates }));
  };

  // Reorder frames in timeline
  const handleReorderFrames = (newFrames: FrameItem[]) => {
    setFrames(newFrames);
  };

  // Update scene text or settings (upsert)
  const handleUpdateScene = (updatedScene: SceneItem) => {
    setScenes((prev) => {
      const idx = prev.findIndex(
        (s) =>
          s.id === updatedScene.id ||
          (updatedScene.chapterId &&
            updatedScene.pageNumber &&
            s.chapterId === updatedScene.chapterId &&
            s.pageNumber === updatedScene.pageNumber)
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...updatedScene };
        return copy;
      }
      return [...prev, updatedScene];
    });
  };

  // Add new scene
  const handleAddScene = () => {
    const nextIdx = scenes.length + 1;
    const newScene: SceneItem = {
      id: `s_${Date.now()}`,
      title: `Cena ${String(nextIdx).padStart(2, '0')} — Nova Cena`,
      frames: frames.slice(0, 2),
      voice: 'Rafael (grave)',
      duration: '0:06',
      text: 'Uma nova tempestade se formava no horizonte, anunciando o confronto final.',
    };
    setScenes((prev) => [...prev, newScene]);
    showToast(`Cena ${String(nextIdx).padStart(2, '0')} criada com sucesso!`);
  };

  // Delete scene
  const handleDeleteScene = (sceneId: string) => {
    setScenes((prev) => prev.filter((s) => s.id !== sceneId));
    showToast('Cena removida do roteiro', 'info');
  };

  // Configure Header Title & Subtitle based on Tab
  let title = '1. Recorte de quadros';
  let subtitle = chapters.length > 0 && currentChapter.id !== 'empty'
    ? `${currentChapter.label} · página ${currentPageNumber} de ${Math.max(1, currentChapter.pages)}`
    : 'Nenhum capítulo carregado — importe uma pasta para começar';

  const persistenceControlsNode = (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {/* Auto-save status badge */}
      {saveStatus === 'saving' && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary/80 text-[11px] font-medium text-muted-foreground border border-border animate-pulse">
          <RefreshCw className="h-3 w-3 animate-spin text-primary" />
          <span className="hidden sm:inline">Salvando...</span>
        </span>
      )}
      {saveStatus === 'saved' && (
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-[11px] font-semibold text-emerald-500 border border-emerald-500/20 shadow-xs"
          title={`Salvo no IndexedDB às ${new Date(lastSavedAt || Date.now()).toLocaleTimeString()}`}
        >
          <Database className="h-3 w-3 text-emerald-400" />
          <span className="hidden md:inline">Salvo no IndexedDB</span>
        </span>
      )}
      {saveStatus === 'error' && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-destructive/10 text-[11px] font-semibold text-destructive border border-destructive/20 shadow-xs">
          <AlertCircle className="h-3 w-3" />
          <span className="hidden sm:inline">Erro ao Salvar</span>
        </span>
      )}

      {/* Manual Save Button */}
      <button
        type="button"
        onClick={handleManualSave}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary cursor-pointer text-foreground shadow-xs transition-colors"
        title="Salvar alterações no IndexedDB agora"
      >
        <Save className="h-3.5 w-3.5 text-primary" />
        <span className="hidden lg:inline">Salvar</span>
      </button>

      {/* Clear / New Project Button */}
      {(chapters.length > 0 || frames.length > 0) && (
        <button
          type="button"
          onClick={() => setIsConfirmClearModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 cursor-pointer text-muted-foreground transition-colors shadow-xs"
          title="Limpar projeto atual e começar do zero no IndexedDB"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Novo Projeto</span>
        </button>
      )}
    </div>
  );

  let actionsNode: React.ReactNode = null;

  if (currentTab === 'recorte') {
    title = '1. Recorte de quadros';
    subtitle = chapters.length > 0 && currentChapter.id !== 'empty'
      ? `${currentChapter.label} · página ${currentPageNumber} de ${Math.max(1, currentChapter.pages)}`
      : 'Nenhum capítulo carregado — importe uma pasta para começar';
    actionsNode = (
      <div className="flex items-center gap-2">
        {persistenceControlsNode}

        <button
          onClick={handleLoadDemoProject}
          className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold hover:bg-secondary sm:inline-flex cursor-pointer text-muted-foreground hover:text-foreground"
          title="Restaurar projeto de exemplo com Solo Leveling"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Demo</span>
        </button>

        <label className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary cursor-pointer">
          <FolderUp className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Importar pasta</span>
          <input
            type="file"
            // @ts-expect-error webkitdirectory
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e) => e.target.files && handleUploadFolder(e.target.files)}
            className="hidden"
          />
        </label>
      </div>
    );
  } else if (currentTab === 'roteiro') {
    title = '2. Roteiro e Contexto';
    subtitle = `${currentChapter.label} · página ${currentPageNumber} de ${Math.max(1, currentChapter.pages)} · Fase 1 (Visão 1x) & Fase 2 (Perfis de Roteiro)`;
    actionsNode = (
      <div className="flex items-center gap-2">
        {persistenceControlsNode}
      </div>
    );
  } else if (currentTab === 'narracao') {
    const chaptersWithCuts = chapters.filter((ch) =>
      frames.some((f) => f.chapterId === ch.id)
    );
    const pagesWithCutsCount = new Set(
      frames.filter((f) => f.chapterId && f.pageNumber).map((f) => `${f.chapterId}_${f.pageNumber}`)
    ).size;

    title = '3. Narração e Síntese de Voz (TTS)';
    subtitle =
      pagesWithCutsCount > 0
        ? `${pagesWithCutsCount} páginas com recortes · ${frames.length} cenas em ${chaptersWithCuts.length} capítulo(s)`
        : 'Recorte quadros no Capítulo para gerar a narração';
    actionsNode = (
      <div className="flex items-center gap-2">
        {persistenceControlsNode}
      </div>
    );
  } else if (currentTab === 'montagem') {
    title = '4. Montagem e timeline';
    subtitle = `${frames.length} quadros na timeline · ${scenes.length} cenas`;
    actionsNode = (
      <div className="flex items-center gap-2">
        {persistenceControlsNode}

        <button
          onClick={() => setIsExportModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-secondary cursor-pointer"
        >
          <Play className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Exportar / Renderizar</span>
        </button>
      </div>
    );
  }

  if (isHydrating) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-surface text-foreground select-none">
        <div className="relative flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary shadow-lg animate-pulse">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div className="text-center">
            <h2 className="font-display text-base font-bold text-foreground">
              Carregando Projeto Local...
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Restaurando capítulos, quadros e áudios do IndexedDB
            </p>
          </div>
        </div>
      </div>
    );
  }

  const effectiveChapterId = currentChapterId || currentChapter?.id || (chapters.length > 0 ? chapters[0].id : '');

  return (
    <StudioShell
      currentTab={currentTab}
      onTabChange={setCurrentTab}
      title={title}
      subtitle={subtitle}
      actions={actionsNode}
      onExportClick={() => setIsExportModalOpen(true)}
    >
      <div className={currentTab === 'recorte' ? 'flex flex-1 flex-col' : 'hidden'}>
        <RecorteView
          chapters={chapters}
          currentChapterId={effectiveChapterId}
          onSelectChapter={setCurrentChapterId}
          currentPageNumber={currentPageNumber}
          onSelectPageNumber={setCurrentPageNumber}
          frames={frames}
          chapterPanels={chapterPanels}
          onUpdateChapterPanels={setChapterPanels}
          onAddFrame={handleAddFrame}
          onRemoveFrame={handleRemoveFrame}
          onUpdateFrame={handleUpdateFrame}
          onUploadFolder={handleUploadFolder}
          onDeleteChapter={handleDeleteChapter}
          onDeleteChapters={handleDeleteChapters}
          onClearAllChapters={handleClearAllChapters}
          onSortChapters={handleSortChapters}
          onAddChapter={handleAddChapter}
        />
      </div>

      <div className={currentTab === 'roteiro' ? 'flex flex-1 flex-col' : 'hidden'}>
        <RoteiroView
          chapters={chapters}
          frames={frames}
          scenes={scenes}
          currentChapterId={effectiveChapterId}
          currentPageNumber={currentPageNumber}
          projectMetadata={projectMetadata}
          chapterMetadata={chapterMetadata}
          pageScripts={pageScripts}
          onUpdateProjectMetadata={handleUpdateProjectMetadata}
          onUpdateChapterMetadata={handleUpdateChapterMetadata}
          onUpdatePageScript={handleUpdatePageScript}
          onUpdateMultiplePageScripts={handleUpdateMultiplePageScripts}
          onUpdateFrameSnippets={handleUpdateMultipleFrames}
          onUpdateSceneText={handleUpdateSceneText}
          onSelectChapter={setCurrentChapterId}
          onSelectPage={setCurrentPageNumber}
          onNavigateTab={setCurrentTab}
        />
      </div>

      <div className={currentTab === 'narracao' ? 'flex flex-1 flex-col' : 'hidden'}>
        <NarracaoView
          chapters={chapters}
          allFrames={frames}
          scenes={scenes}
          onUpdateScene={handleUpdateScene}
          onSetScenes={setScenes}
          onAddScene={handleAddScene}
          onDeleteScene={handleDeleteScene}
          onRemoveFrame={handleRemoveFrame}
          onUpdateFrame={handleUpdateFrame}
          onUpdateMultipleFrames={handleUpdateMultipleFrames}
          onGoToRecorte={() => setCurrentTab('roteiro')}
          onGoToMontagem={() => setCurrentTab('montagem')}
        />
      </div>

      <div className={currentTab === 'montagem' ? 'flex flex-1 flex-col' : 'hidden'}>
        <MontagemView
          chapters={chapters}
          frames={frames}
          scenes={scenes}
          onExportRecap={(fmt) => {
            if (fmt) setExportModalFormat(fmt);
            setIsExportModalOpen(true);
          }}
          onUpdateFrameDuration={handleUpdateFrameDuration}
          onUpdateMultipleFrames={handleUpdateMultipleFrames}
          onReorderFrames={handleReorderFrames}
          onRemoveFrame={handleRemoveFrame}
          onGoToRecorte={() => setCurrentTab('recorte')}
          onGoToNarracao={() => setCurrentTab('narracao')}
        />
      </div>

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur animate-fade-in text-xs font-semibold ${
            toastMessage.type === 'error'
              ? 'border-destructive/50 bg-destructive/90 text-destructive-foreground'
              : toastMessage.type === 'info'
              ? 'border-border bg-card/95 text-foreground'
              : 'border-primary/40 bg-[#181a20]/95 text-foreground'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-white" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        chapters={chapters}
        frames={frames}
        scenes={scenes}
        initialFormat={exportModalFormat}
        onImportProject={(data) => {
          if (data.chapters) setChapters(data.chapters);
          if (data.frames) setFrames(data.frames);
          if (data.scenes) setScenes(data.scenes);
          showToast('Projeto importado com sucesso!');
        }}
      />

      {/* Confirmation Modal: Novo Projeto / Limpar IndexedDB */}
      {isConfirmClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive shadow-xs">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-foreground">
                  Iniciar Novo Projeto?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Esta ação limpará o estado e removerá todos os dados do IndexedDB.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Todos os capítulos importados, imagens originais, recortes de quadros e áudios de narração salvos localmente no navegador serão excluídos permanentemente.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIsConfirmClearModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg border border-border bg-secondary hover:bg-secondary/80 text-xs font-semibold text-foreground transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleClearProjectConfirm}
                className="px-3.5 py-1.5 rounded-lg bg-destructive hover:bg-destructive/90 text-xs font-bold text-destructive-foreground transition-colors cursor-pointer shadow"
              >
                Limpar e Começar do Zero
              </button>
            </div>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
