import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ScrollText,
  Sparkles,
  Settings2,
  Plus,
  Trash2,
  Check,
  Star,
  Copy,
  BookOpen,
  Users,
  SlidersHorizontal,
  ArrowRight,
  ArrowLeft,
  X,
  User,
  Shield,
  Swords,
  Maximize2,
  Loader2,
  Code2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  FileSearch,
  Zap,
  HelpCircle,
  RefreshCw,
  Link2,
} from 'lucide-react';
import {
  ChapterItem,
  FrameItem,
  SceneItem,
  ProjectMetadata,
  ChapterMetadata,
  ChapterMacroContext,
  PageScriptState,
  ScriptProfile,
  CharacterMetadata,
  CharacterRole,
  SceneExtractedContext,
  ChapterNarrativeMemory,
} from '../types';
import {
  NARRATION_PROFILES,
  buildChapterNarrationSystemPrompt,
  analyzeChapterMacroContext,
  generateChapterNarrationInMiniBatches,
  generatePageNarrationWithVision,
  extractChapterVisualContext,
  generateChapterNarrationFromContext,
  generatePageNarrationFromContext,
  loadAiNarrationConfig,
  distributeTextToFrames,
  matchAiSceneToFrame,
  ChapterPageItem,
} from '../utils/aiNarration';
import {
  resolvePreviousChapterMemory,
  compileChapterMemoryEntry,
  upsertProjectNarrativeHistory,
} from '../utils/narrativeMemory';
import {
  getChapterThumbnails,
  generateChapterThumbnailsSequentially,
} from '../utils/thumbnailCache';

interface RoteiroViewProps {
  chapters: ChapterItem[];
  frames: FrameItem[];
  scenes: SceneItem[];
  currentChapterId: string;
  currentPageNumber: number;
  projectMetadata: ProjectMetadata;
  chapterMetadata: Record<string, ChapterMetadata>;
  pageScripts: Record<string, PageScriptState>;
  onUpdateProjectMetadata: (metadata: ProjectMetadata) => void;
  onUpdateChapterMetadata: (chapterId: string, metadata: ChapterMetadata) => void;
  onUpdatePageScript: (key: string, scriptState: PageScriptState) => void;
  onUpdateMultiplePageScripts?: (updates: Record<string, PageScriptState>) => void;
  onUpdateFrameSnippets: (updates: { id: string; narrationSnippet?: string; duration?: number; transition?: any }[]) => void;
  onUpdateSceneText: (sceneId: string, text: string) => void;
  onUpdateScene?: (scene: SceneItem) => void;
  onSetScenes?: (scenes: SceneItem[]) => void;
  onSelectChapter: (chapterId: string) => void;
  onSelectPage: (pageNumber: number) => void;
  onNavigateTab: (tab: 'recorte' | 'narracao') => void;
}

const SOM_PALETTE = [
  { border: '#00FF66', bg: 'rgba(0, 255, 102, 0.85)', text: '#000000' },
  { border: '#FFE600', bg: 'rgba(255, 230, 0, 0.85)', text: '#000000' },
  { border: '#00F0FF', bg: 'rgba(0, 240, 255, 0.85)', text: '#000000' },
  { border: '#FF0077', bg: 'rgba(255, 0, 119, 0.85)', text: '#FFFFFF' },
  { border: '#FF6600', bg: 'rgba(255, 102, 0, 0.85)', text: '#FFFFFF' },
  { border: '#9933FF', bg: 'rgba(153, 51, 255, 0.85)', text: '#FFFFFF' },
];

export const RoteiroView: React.FC<RoteiroViewProps> = ({
  chapters,
  frames,
  scenes,
  currentChapterId,
  currentPageNumber,
  projectMetadata,
  chapterMetadata,
  pageScripts,
  onUpdateProjectMetadata,
  onUpdateChapterMetadata,
  onUpdatePageScript,
  onUpdateMultiplePageScripts,
  onUpdateFrameSnippets,
  onUpdateSceneText,
  onUpdateScene,
  onSetScenes,
  onSelectChapter,
  onSelectPage,
  onNavigateTab,
}) => {
  // Estado local de navegação e visualização
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [isMetadataDrawerOpen, setIsMetadataDrawerOpen] = useState(false);
  const [isMacroAnalyzing, setIsMacroAnalyzing] = useState(false);
  const [isScriptGenerating, setIsScriptGenerating] = useState(false);
  const [isBatchScriptGenerating, setIsBatchScriptGenerating] = useState(false);
  const [isInspectPromptOpen, setIsInspectPromptOpen] = useState(false);
  const [promptEditText, setPromptEditText] = useState('');
  const [newCriticalRuleInput, setNewCriticalRuleInput] = useState('');
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    stage: string;
  } | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [isAddingCustomProfile, setIsAddingCustomProfile] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Novos estados para Pipeline em 2 Etapas e Memória Narrativa
  const [rightSidebarTab, setRightSidebarTab] = useState<'roteiro' | 'contexto'>('roteiro');
  const [isContinuityExpanded, setIsContinuityExpanded] = useState(false);
  const [isExtractingContext, setIsExtractingContext] = useState(false);

  // Progressive hydration of low-res proxy thumbnails for filmstrip
  const [chapterThumbnails, setChapterThumbnails] = useState<Record<number, string>>({});
  const activeThumbRef = useRef<HTMLButtonElement | null>(null);
  const frameCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const showToast = (msg: string, _type?: 'success' | 'info' | 'error') => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Capítulo atual
  const currentChapter = useMemo(
    () => chapters.find((c) => c.id === currentChapterId) || chapters[0],
    [chapters, currentChapterId]
  );

  const activeChapterId = currentChapter?.id || currentChapterId || 'default';

  const matchesChapter = (itemChapterId?: string) => {
    if (!itemChapterId) return true;
    return (
      itemChapterId === activeChapterId ||
      (currentChapterId ? itemChapterId === currentChapterId : false) ||
      (currentChapter?.id ? itemChapterId === currentChapter.id : false)
    );
  };

  const totalPages = currentChapter?.pages || 1;

  // Carregamento progressivo de miniaturas para o filmstrip
  useEffect(() => {
    let isCancelled = false;

    if (!currentChapterId || !currentChapter?.imageUrls || currentChapter.imageUrls.length === 0) {
      setChapterThumbnails({});
      return;
    }

    getChapterThumbnails(currentChapterId).then((cached) => {
      if (isCancelled) return;
      if (cached && Object.keys(cached).length > 0) {
        setChapterThumbnails(cached);
      }
    });

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
  }, [currentChapterId, currentChapter?.imageUrls]);

  // Scroll automático do filmstrip para centralizar a página ativa
  useEffect(() => {
    if (activeThumbRef.current) {
      activeThumbRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentPageNumber]);

  // Navegação de páginas com as setas do teclado (Esquerda / Direita) quando não estiver digitando
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onSelectPage(Math.max(1, currentPageNumber - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onSelectPage(Math.min(totalPages, currentPageNumber + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPageNumber, totalPages, onSelectPage]);

  // Imagem da página atual
  const currentPageImageUrl = useMemo(() => {
    if (!currentChapter?.imageUrls) return '';
    return currentChapter.imageUrls[currentPageNumber - 1] || '';
  }, [currentChapter, currentPageNumber]);

  // Quadros da página atual ordenados
  const currentPageFrames = useMemo(() => {
    return frames
      .filter(
        (f) =>
          matchesChapter(f.chapterId) &&
          Number(f.pageNumber) === Number(currentPageNumber)
      )
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
      );
  }, [frames, activeChapterId, currentChapterId, currentChapter?.id, currentPageNumber]);

  // Cena correspondente à página atual
  const currentPageScene = useMemo(() => {
    return (
      scenes.find(
        (s) =>
          matchesChapter(s.chapterId) &&
          Number(s.pageNumber) === Number(currentPageNumber)
      ) || scenes[0]
    );
  }, [scenes, activeChapterId, currentChapterId, currentChapter?.id, currentPageNumber]);

  // Chave de identificação no mapa de scripts: "chapterId_pageNumber"
  const pageScriptKey = `${activeChapterId}_${currentPageNumber}`;

  // Continuidade narrativa com o capítulo imediatamente anterior (N - 1)
  const previousChapterMemory = useMemo(() => {
    return resolvePreviousChapterMemory({
      chapters,
      currentChapterId: activeChapterId,
      narrativeHistory: projectMetadata.narrativeHistory,
      scenes,
      chapterMetadata,
    });
  }, [chapters, activeChapterId, projectMetadata.narrativeHistory, scenes, chapterMetadata]);

  // Cenas do capítulo atual
  const chapterScenes = useMemo(() => {
    return scenes.filter((s) => matchesChapter(s.chapterId));
  }, [scenes, activeChapterId, currentChapterId, currentChapter?.id]);

  // Contagem de páginas com contexto visual extraído
  const extractedScenesCount = useMemo(() => {
    return chapterScenes.filter((s) => Boolean(s.extractedContext)).length;
  }, [chapterScenes]);

  const isChapterContextExtracted = Boolean(
    chapterMetadata[currentChapterId]?.isContextExtracted ||
    (totalPages > 0 && extractedScenesCount > 0 && extractedScenesCount >= totalPages)
  );

  // Estado do script da página atual com todos os 4 perfis nativos pré-carregados
  const currentPageScriptState: PageScriptState = useMemo(() => {
    const existing =
      pageScripts[pageScriptKey] ||
      (currentChapterId ? pageScripts[`${currentChapterId}_${currentPageNumber}`] : undefined) ||
      (currentChapter?.id ? pageScripts[`${currentChapter?.id}_${currentPageNumber}`] : undefined) ||
      pageScripts[`default_${currentPageNumber}`];

    // Helper para obter o system prompt completo e rico do perfil
    const getRealSystemPrompt = (profileId: string) => {
      return buildChapterNarrationSystemPrompt(
        profileId,
        undefined,
        projectMetadata,
        chapterMetadata[currentChapterId]
      );
    };

    // Constrói os 4 perfis nativos padrão
    const initialProfiles: ScriptProfile[] = NARRATION_PROFILES.map((np) => {
      const snippets: Record<string, string> = {};
      currentPageFrames.forEach((f) => {
        if (f.narrationSnippet) {
          snippets[f.id] = f.narrationSnippet;
        }
      });
      const fullText =
        currentPageScene?.text || Object.values(snippets).filter(Boolean).join(' ');
      return {
        id: np.id,
        name: np.name,
        systemPromptPreset: getRealSystemPrompt(np.id),
        snippetsByFrameId: snippets,
        fullScriptText: fullText,
        createdAt: Date.now(),
      };
    });

    if (existing) {
      // Garante que todos os 4 perfis nativos estejam presentes mesmo em projetos antigos salvos
      const existingIds = new Set(existing.profiles.map((p) => p.id));
      const baselineSnippets: Record<string, string> = {};
      currentPageFrames.forEach((f) => {
        if (f.narrationSnippet) {
          baselineSnippets[f.id] = f.narrationSnippet;
        }
      });
      const baselineText =
        currentPageScene?.text || Object.values(baselineSnippets).filter(Boolean).join(' ');

      const missingNative = NARRATION_PROFILES.filter((np) => !existingIds.has(np.id)).map((np) => ({
        id: np.id,
        name: np.name,
        systemPromptPreset: getRealSystemPrompt(np.id),
        snippetsByFrameId: { ...baselineSnippets },
        fullScriptText: baselineText,
        createdAt: Date.now(),
      }));

      let mergedProfiles =
        missingNative.length > 0
          ? [...existing.profiles, ...missingNative]
          : existing.profiles;

      // Garante que todo perfil tenha seu prompt completo e textos preenchidos
      mergedProfiles = mergedProfiles.map((p) => {
        const needsPromptFix = !p.systemPromptPreset || p.systemPromptPreset.length < 80;
        const updatedPrompt = needsPromptFix ? getRealSystemPrompt(p.id) : p.systemPromptPreset;
        const updatedSnippets = { ...p.snippetsByFrameId };
        let hasChanges = needsPromptFix;

        currentPageFrames.forEach((f) => {
          if (!updatedSnippets[f.id] && f.narrationSnippet) {
            updatedSnippets[f.id] = f.narrationSnippet;
            hasChanges = true;
          }
        });

        const combinedText =
          p.fullScriptText ||
          currentPageScene?.text ||
          Object.values(updatedSnippets).filter(Boolean).join(' ');

        if (hasChanges || (!p.fullScriptText && combinedText)) {
          return {
            ...p,
            systemPromptPreset: updatedPrompt,
            snippetsByFrameId: updatedSnippets,
            fullScriptText: combinedText,
          };
        }
        return p;
      });

      const activeValid = mergedProfiles.some((p) => p.id === existing.activeProfileId)
        ? existing.activeProfileId
        : mergedProfiles[0]?.id || 'epico';

      return {
        ...existing,
        chapterId: activeChapterId,
        activeProfileId: activeValid,
        profiles: mergedProfiles,
      };
    }

    return {
      pageNumber: currentPageNumber,
      chapterId: activeChapterId,
      rawContext: [],
      activeProfileId: 'epico',
      profiles: initialProfiles,
    };
  }, [
    pageScripts,
    pageScriptKey,
    currentPageNumber,
    activeChapterId,
    currentChapterId,
    currentChapter?.id,
    currentPageScene,
    currentPageFrames,
  ]);

  // Perfil ativo da página
  const activeProfile: ScriptProfile = useMemo(() => {
    return (
      currentPageScriptState.profiles.find(
        (p) => p.id === currentPageScriptState.activeProfileId
      ) ||
      currentPageScriptState.profiles[0] || {
        id: 'epico',
        name: 'Cronista Épico',
        snippetsByFrameId: {},
        fullScriptText: '',
        createdAt: Date.now(),
      }
    );
  }, [currentPageScriptState]);

  // Scroll automático para focar o quadro selecionado
  useEffect(() => {
    if (selectedFrameId && frameCardRefs.current[selectedFrameId]) {
      frameCardRefs.current[selectedFrameId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedFrameId]);

  // Salva atualizações do estado do script da página
  const updateCurrentScriptState = (newState: PageScriptState) => {
    onUpdatePageScript(pageScriptKey, newState);
  };

  // Coerência bidirecional: Usuário edita o snippet de um quadro
  const handleFrameSnippetChange = (frameId: string, newSnippetText: string) => {
    const updatedSnippets = {
      ...activeProfile.snippetsByFrameId,
      [frameId]: newSnippetText,
    };

    // Recalcula o fullScriptText ordenando os quadros
    const updatedFullText = currentPageFrames
      .map((f) => (f.id === frameId ? newSnippetText : updatedSnippets[f.id] || '').trim())
      .filter(Boolean)
      .join(' ');

    const updatedProfile: ScriptProfile = {
      ...activeProfile,
      snippetsByFrameId: updatedSnippets,
      fullScriptText: updatedFullText,
    };

    const updatedProfiles = currentPageScriptState.profiles.map((p) =>
      p.id === activeProfile.id ? updatedProfile : p
    );

    updateCurrentScriptState({
      ...currentPageScriptState,
      profiles: updatedProfiles,
    });

    // Se o perfil editado for o ativo, reflete imediatamente na montagem e timeline
    if (activeProfile.id === currentPageScriptState.activeProfileId) {
      onUpdateFrameSnippets([{ id: frameId, narrationSnippet: newSnippetText }]);
      if (currentPageScene) {
        onUpdateSceneText(currentPageScene.id, updatedFullText);
      }
    }
  };

  // Coerência bidirecional: Usuário edita o texto completo unificado (fullScriptText)
  const handleFullScriptTextChange = (newFullText: string) => {
    // Redistribui as frases proporcionalmente entre os quadros
    const distributed = distributeTextToFrames(newFullText, currentPageFrames);
    const updatedSnippets: Record<string, string> = {};
    const frameUpdates: { id: string; narrationSnippet: string }[] = [];

    currentPageFrames.forEach((f, idx) => {
      const snippet = distributed[idx] || '';
      updatedSnippets[f.id] = snippet;
      frameUpdates.push({ id: f.id, narrationSnippet: snippet });
    });

    const updatedProfile: ScriptProfile = {
      ...activeProfile,
      snippetsByFrameId: updatedSnippets,
      fullScriptText: newFullText,
    };

    const updatedProfiles = currentPageScriptState.profiles.map((p) =>
      p.id === activeProfile.id ? updatedProfile : p
    );

    updateCurrentScriptState({
      ...currentPageScriptState,
      profiles: updatedProfiles,
    });

    if (activeProfile.id === currentPageScriptState.activeProfileId) {
      onUpdateFrameSnippets(frameUpdates);
      if (currentPageScene) {
        onUpdateSceneText(currentPageScene.id, newFullText);
      }
    }
  };

  const handleDistributeToFrames = () => {
    handleFullScriptTextChange(activeProfile.fullScriptText || '');
    showToast('✨ Texto distribuído proporcionalmente entre os quadros!');
  };

  // Alternar ou Selecionar perfil de estilo (com Cache Instantâneo se já houver texto gerado)
  const handleSelectOrSwitchProfile = (profileId: string) => {
    const targetProfile = currentPageScriptState.profiles.find((p) => p.id === profileId);
    if (!targetProfile) return;

    const hasCachedText = Boolean(
      targetProfile.fullScriptText?.trim() ||
      Object.values(targetProfile.snippetsByFrameId || {}).some((s) => s?.trim())
    );

    updateCurrentScriptState({
      ...currentPageScriptState,
      activeProfileId: profileId,
    });

    if (hasCachedText) {
      // Restauração instantânea do cache local sem chamada de API
      const updates: { id: string; narrationSnippet: string }[] = [];
      currentPageFrames.forEach((f) => {
        const snippet = targetProfile.snippetsByFrameId[f.id] || '';
        updates.push({ id: f.id, narrationSnippet: snippet });
      });

      onUpdateFrameSnippets(updates);
      if (currentPageScene) {
        onUpdateSceneText(currentPageScene.id, targetProfile.fullScriptText);
        if (onUpdateScene) {
          onUpdateScene({
            ...currentPageScene,
            text: targetProfile.fullScriptText,
            appliedStyleId: profileId,
          });
        }
      }
      showToast(`✨ Estilo "${targetProfile.name}" restaurado instantaneamente do cache!`);
    } else {
      showToast(`Estilo "${targetProfile.name}" selecionado.`);
    }
  };

  const handleSetActiveProfile = handleSelectOrSwitchProfile;

  // Edição manual do contexto extraído na Sidebar Direita
  const handleUpdateExtractedContext = (
    field: 'rawDialoguesAndText' | 'visualDescription' | 'sceneBeat',
    val: string
  ) => {
    if (!currentPageScene) return;
    const currentExtracted: SceneExtractedContext = currentPageScene.extractedContext || {
      rawDialoguesAndText: '',
      visualDescription: '',
      charactersInScene: [],
      sceneBeat: 'Desenvolvimento',
      frameCount: currentPageFrames.length || 1,
      extractedAt: Date.now(),
    };

    const updatedContext: SceneExtractedContext = {
      ...currentExtracted,
      [field]: val,
    };

    if (onUpdateScene) {
      onUpdateScene({
        ...currentPageScene,
        extractedContext: updatedContext,
      });
    }
  };

  // GERAÇÃO MULTIMODAL DIRETA DA PÁGINA ATUAL (Fiel à arte, 12-22 palavras, 5-9.5s)
  const handleGenerateScript = async (targetProfileId?: string) => {
    if (!currentPageImageUrl) {
      showToast('Imagem da página não encontrada.');
      return;
    }
    if (currentPageFrames.length === 0) {
      showToast('Nenhum quadro recortado nesta página.');
      return;
    }

    const profileIdToGen = targetProfileId || activeProfile.id;
    const currentProfile =
      currentPageScriptState.profiles.find((p) => p.id === profileIdToGen) || activeProfile;

    // Obtém texto da página anterior para continuidade
    const prevKey = `${currentChapterId || 'default'}_${currentPageNumber - 1}`;
    const prevPageScript = pageScripts[prevKey]?.profiles.find(
      (p) => p.id === pageScripts[prevKey]?.activeProfileId
    )?.fullScriptText;

    setIsScriptGenerating(true);
    try {
      const pageRes = await generatePageNarrationWithVision({
        rawImageUrl: currentPageImageUrl,
        chapterLabel: currentChapter?.label || 'Capítulo',
        pageNumber: currentPageNumber,
        totalPages,
        croppedFramesCount: currentPageFrames.length,
        croppedFramesLabels: currentPageFrames.map((f) => f.label),
        frames: currentPageFrames,
        previousPageNarration: prevPageScript,
        stylePresetId: profileIdToGen,
        customSystemPrompt: currentProfile.systemPromptPreset,
        projectMetadata,
        chapterMetadata: chapterMetadata[currentChapterId],
      });

      const updatedSnippets: Record<string, string> = { ...currentProfile.snippetsByFrameId };
      const frameUpdates: { id: string; narrationSnippet: string; duration?: number; transition?: any }[] = [];

      currentPageFrames.forEach((frame, idx) => {
        const matched = matchAiSceneToFrame(frame, idx, pageRes.cenas);
        const snippet = matched?.roteiro_cena?.trim() || '';
        updatedSnippets[frame.id] = snippet;
        frameUpdates.push({
          id: frame.id,
          narrationSnippet: snippet,
          duration: matched?.duracao_segundos,
          transition: matched?.transicao,
        });
      });

      const fullScript = pageRes.fullScript;
      const updatedProfile: ScriptProfile = {
        ...currentProfile,
        id: profileIdToGen,
        snippetsByFrameId: updatedSnippets,
        fullScriptText: fullScript,
      };

      const updatedProfiles = currentPageScriptState.profiles.map((p) =>
        p.id === profileIdToGen ? updatedProfile : p
      );

      updateCurrentScriptState({
        ...currentPageScriptState,
        activeProfileId: profileIdToGen,
        profiles: updatedProfiles,
      });

      onUpdateFrameSnippets(frameUpdates);
      if (currentPageScene) {
        onUpdateSceneText(currentPageScene.id, fullScript);
      }

      showToast(`Roteiro da Página ${currentPageNumber} gerado com sucesso!`);
    } catch (err: any) {
      showToast(`Erro na geração: ${err?.message || 'Falha'}`);
    } finally {
      setIsScriptGenerating(false);
    }
  };

  // ANÁLISE MACRO DO CAPÍTULO (Bíblia Fática & Verdade dos Personagens)
  const handleAnalyzeChapterMacro = async () => {
    if (isMacroAnalyzing || isBatchScriptGenerating || isScriptGenerating) return;

    if (!currentChapter?.imageUrls || currentChapter.imageUrls.length === 0) {
      showToast('Nenhuma imagem disponível neste capítulo.');
      return;
    }

    const pagesWithImages: ChapterPageItem[] = [];
    for (let pNum = 1; pNum <= totalPages; pNum++) {
      const pImg = currentChapter.imageUrls[pNum - 1];
      if (pImg) {
        pagesWithImages.push({
          pageNumber: pNum,
          rawImageUrl: pImg,
          croppedFramesCount: 1,
        });
      }
    }

    if (pagesWithImages.length === 0) {
      showToast('Nenhuma imagem encontrada no capítulo.');
      return;
    }

    setIsMacroAnalyzing(true);
    try {
      showToast('Analisando enredo macro e verdade dos personagens com IA...');
      const macroRes = await analyzeChapterMacroContext({
        chapterLabel: currentChapter?.label || 'Capítulo',
        pages: pagesWithImages,
        projectMetadata,
        chapterMetadata: chapterMetadata[currentChapterId],
        onProgress: (p) => {
          showToast(p.stage);
        },
      });

      const updatedMacro: ChapterMacroContext = {
        synopsis: macroRes.synopsis,
        characterDynamics: macroRes.characterDynamics,
        criticalRules: macroRes.criticalRules,
        suggestedWorkTitle: macroRes.suggestedWorkTitle,
        analyzedAt: Date.now(),
      };

      onUpdateChapterMetadata(currentChapterId, {
        ...(chapterMetadata[currentChapterId] || { chapterId: currentChapterId }),
        chapterId: currentChapterId,
        synopsis: macroRes.synopsis || chapterMetadata[currentChapterId]?.synopsis || '',
        macroContext: updatedMacro,
      });

      // Atualiza título da obra se identificado e não preenchido
      if (macroRes.suggestedWorkTitle && !projectMetadata.workTitle) {
        onUpdateProjectMetadata({
          ...projectMetadata,
          workTitle: macroRes.suggestedWorkTitle,
        });
      }

      // Adiciona novos personagens detectados caso a lista esteja vazia
      if (
        macroRes.detectedCharacters &&
        macroRes.detectedCharacters.length > 0 &&
        projectMetadata.characters.length === 0
      ) {
        onUpdateProjectMetadata({
          ...projectMetadata,
          characters: macroRes.detectedCharacters,
        });
      }

      showToast(`Bíblia do Capítulo consolidada! ${macroRes.criticalRules.length} diretrizes anti-alucinação salvas.`);
    } catch (err: any) {
      showToast(`Erro na análise macro: ${err?.message || 'Falha'}`);
    } finally {
      setIsMacroAnalyzing(false);
    }
  };

  // ETAPA 1: Extração de Texto e Contexto Visual das Imagens (Multimodal)
  const handleExtractChapterContext = async () => {
    if (isExtractingContext || isBatchScriptGenerating || isScriptGenerating) return;

    const effectiveChapterId = currentChapterId || currentChapter?.id || 'default';
    const numPages = Math.max(
      currentChapter?.imageUrls?.length || 0,
      currentChapter?.pages || 0,
      totalPages
    );

    const pagesWithFrames: ChapterPageItem[] = [];
    for (let pNum = 1; pNum <= numPages; pNum++) {
      const pFrames = frames
        .filter(
          (f) =>
            (f.chapterId ? (f.chapterId === effectiveChapterId || (currentChapter?.id && f.chapterId === currentChapter.id)) : true) &&
            Number(f.pageNumber) === pNum
        )
        .sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
        );
      const pImg = currentChapter?.imageUrls ? currentChapter.imageUrls[pNum - 1] : '';

      if (pImg) {
        let effectiveFrames = pFrames;
        if (effectiveFrames.length === 0) {
          effectiveFrames = [
            {
              id: `frame_${effectiveChapterId}_p${pNum}_auto`,
              label: `Quadro 01 (Pág. ${pNum})`,
              src: pImg,
              ratio: '9:16',
              duration: 6.5,
              chapterId: effectiveChapterId,
              pageNumber: pNum,
            },
          ];
        }

        pagesWithFrames.push({
          pageNumber: pNum,
          rawImageUrl: pImg,
          croppedFramesCount: effectiveFrames.length,
          croppedFramesLabels: effectiveFrames.map((f) => f.label),
          frames: effectiveFrames,
        });
      }
    }

    if (pagesWithFrames.length === 0) {
      showToast('Nenhuma imagem encontrada no capítulo para extração visual.');
      return;
    }

    setIsExtractingContext(true);
    try {
      const res = await extractChapterVisualContext({
        chapterLabel: currentChapter?.label || 'Capítulo',
        pages: pagesWithFrames,
        projectMetadata,
        chapterMetadata: chapterMetadata[currentChapterId],
        previousChapterMemory,
        batchSize: 2,
        concurrency: 2,
        onProgress: (info) => {
          setBatchProgress({
            current: info.current || 1,
            total: info.total || 1,
            stage: info.stage,
          });
        },
        onMacroContextReady: (macro, detectedChars, suggestedTitle) => {
          onUpdateChapterMetadata(currentChapterId, {
            ...(chapterMetadata[currentChapterId] || { chapterId: currentChapterId }),
            chapterId: currentChapterId,
            synopsis: macro.synopsis,
            macroContext: macro,
          });
          if (suggestedTitle && !projectMetadata.workTitle) {
            onUpdateProjectMetadata({ ...projectMetadata, workTitle: suggestedTitle });
          }
          if (detectedChars && detectedChars.length > 0 && projectMetadata.characters.length === 0) {
            onUpdateProjectMetadata({ ...projectMetadata, characters: detectedChars });
          }
        },
      });

      // Atualiza cenas existentes com o contexto extraído
      const updatedScenes = scenes.map((s) => {
        if (matchesChapter(s.chapterId) && s.pageNumber && res.extractedPages[s.pageNumber]) {
          return {
            ...s,
            extractedContext: res.extractedPages[s.pageNumber],
          };
        }
        return s;
      });

      if (onSetScenes) {
        onSetScenes(updatedScenes);
      } else if (onUpdateScene) {
        updatedScenes.filter((s) => matchesChapter(s.chapterId)).forEach(onUpdateScene);
      }

      // Atualiza metadados do capítulo com status de extração
      const updatedChapterMeta: ChapterMetadata = {
        ...(chapterMetadata[currentChapterId] || { chapterId: currentChapterId }),
        chapterId: currentChapterId,
        synopsis: res.macroContext?.synopsis || chapterMetadata[currentChapterId]?.synopsis || '',
        macroContext: res.macroContext || chapterMetadata[currentChapterId]?.macroContext,
        endingHook: res.endingHook || chapterMetadata[currentChapterId]?.endingHook,
        narrativeState: res.narrativeState || chapterMetadata[currentChapterId]?.narrativeState,
        keyOutcomes: res.keyOutcomes || chapterMetadata[currentChapterId]?.keyOutcomes,
        isContextExtracted: true,
        lastExtractedAt: Date.now(),
      };
      onUpdateChapterMetadata(currentChapterId, updatedChapterMeta);

      // Compila e persiste memória de continuidade do capítulo
      if (currentChapter) {
        const memEntry = compileChapterMemoryEntry({
          chapter: currentChapter,
          chapterIndex: chapters.findIndex((c) => c.id === currentChapter.id),
          scenes: updatedScenes,
          chapterMetadata: updatedChapterMeta,
        });
        const updatedHistory = upsertProjectNarrativeHistory(projectMetadata.narrativeHistory || [], memEntry);
        onUpdateProjectMetadata({
          ...projectMetadata,
          narrativeHistory: updatedHistory,
        });
      }

      showToast(`✓ Contexto e diálogos extraídos de todas as ${Object.keys(res.extractedPages).length} páginas!`);
    } catch (err: any) {
      showToast(`Erro na extração visual: ${err?.message || 'Falha'}`);
    } finally {
      setIsExtractingContext(false);
      setBatchProgress(null);
    }
  };

  // ETAPA 2: Geração / Reescrita de Roteiro por Estilo (Somente Texto — Zero Imagens)
  const handleBatchGenerateScriptFromContext = async (targetProfileId?: string) => {
    if (isBatchScriptGenerating || isScriptGenerating) return;

    const profileIdToGen = targetProfileId || activeProfile.id;
    const currentProfile =
      currentPageScriptState.profiles.find((p) => p.id === profileIdToGen) || activeProfile;

    const effectiveChapterId = currentChapterId || currentChapter?.id || 'default';
    const numPages = Math.max(
      currentChapter?.imageUrls?.length || 0,
      currentChapter?.pages || 0,
      totalPages
    );

    const pagesForScript: {
      pageNumber: number;
      extractedContext: SceneExtractedContext;
      frames?: FrameItem[];
    }[] = [];

    for (let pNum = 1; pNum <= numPages; pNum++) {
      const scene = chapterScenes.find((s) => Number(s.pageNumber) === pNum);
      const pFrames = frames
        .filter(
          (f) =>
            (f.chapterId ? (f.chapterId === effectiveChapterId || (currentChapter?.id && f.chapterId === currentChapter.id)) : true) &&
            Number(f.pageNumber) === pNum
        )
        .sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
        );

      const effectiveContext: SceneExtractedContext = scene?.extractedContext || {
        rawDialoguesAndText: scene?.text || '(Sem diálogos transcritos)',
        visualDescription: 'Cena visual da página.',
        charactersInScene: [],
        sceneBeat: 'Desenvolvimento',
        frameCount: pFrames.length || 1,
        extractedAt: Date.now(),
      };

      pagesForScript.push({
        pageNumber: pNum,
        extractedContext: effectiveContext,
        frames: pFrames,
      });
    }

    if (pagesForScript.length === 0) {
      showToast('Nenhuma página disponível para geração de roteiro.');
      return;
    }

    setIsBatchScriptGenerating(true);
    try {
      const res = await generateChapterNarrationFromContext({
        chapterLabel: currentChapter?.label || 'Capítulo',
        pages: pagesForScript,
        profileId: profileIdToGen,
        customSystemPrompt: currentProfile.systemPromptPreset,
        projectMetadata,
        chapterMetadata: chapterMetadata[currentChapterId],
        previousChapterMemory,
        batchSize: 2,
        concurrency: 2,
        onProgress: (info) => {
          setBatchProgress({
            current: info.current || 1,
            total: info.total || 1,
            stage: info.stage,
          });
        },
      });

      const allFrameUpdates: { id: string; narrationSnippet: string; duration?: number; transition?: any }[] = [];
      const batchScriptUpdates: Record<string, PageScriptState> = {};
      const updatedScenesList = [...scenes];

      res.paginas.forEach((pageRes) => {
        const pNum = pageRes.pagina_numero;
        const key = `${effectiveChapterId}_${pNum}`;
        const pFrames = frames.filter(
          (f) =>
            matchesChapter(f.chapterId) &&
            Number(f.pageNumber) === pNum
        );

        const pageSnippets: Record<string, string> = {};
        const matchedIndices = new Set<number>();
        pFrames.forEach((frame, idx) => {
          const matched = matchAiSceneToFrame(frame, idx, pageRes.cenas, matchedIndices);
          const snippet = matched?.roteiro_cena?.trim() || '';
          pageSnippets[frame.id] = snippet;
          allFrameUpdates.push({
            id: frame.id,
            narrationSnippet: snippet,
            duration: matched?.duracao_segundos,
            transition: matched?.transicao,
          });
        });

        const existingState =
          pageScripts[key] ||
          (currentChapterId ? pageScripts[`${currentChapterId}_${pNum}`] : undefined) ||
          (currentChapter?.id ? pageScripts[`${currentChapter?.id}_${pNum}`] : undefined) ||
          pageScripts[`default_${pNum}`];

        const updatedProfile: ScriptProfile = {
          id: profileIdToGen,
          name: currentProfile.name,
          systemPromptPreset: currentProfile.systemPromptPreset,
          snippetsByFrameId: pageSnippets,
          fullScriptText: pageRes.roteiro,
          createdAt: Date.now(),
        };

        const baseProfiles = existingState?.profiles || NARRATION_PROFILES.map((np) => ({
          id: np.id,
          name: np.name,
          systemPromptPreset: np.description,
          snippetsByFrameId: {},
          fullScriptText: '',
          createdAt: Date.now(),
        }));

        const updatedProfiles = baseProfiles.map((p) =>
          p.id === profileIdToGen ? updatedProfile : p
        );

        const updatedState: PageScriptState = {
          pageNumber: pNum,
          chapterId: effectiveChapterId,
          rawContext: existingState?.rawContext || [],
          activeProfileId: profileIdToGen,
          profiles: updatedProfiles,
        };

        batchScriptUpdates[key] = updatedState;
        if (effectiveChapterId !== 'default') {
          batchScriptUpdates[`default_${pNum}`] = updatedState;
        }
        if (currentChapterId && currentChapterId !== effectiveChapterId) {
          batchScriptUpdates[`${currentChapterId}_${pNum}`] = updatedState;
        }
        if (currentChapter?.id && currentChapter.id !== effectiveChapterId) {
          batchScriptUpdates[`${currentChapter.id}_${pNum}`] = updatedState;
        }

        const sceneIdx = updatedScenesList.findIndex(
          (s) =>
            matchesChapter(s.chapterId) &&
            Number(s.pageNumber) === pNum
        );
        if (sceneIdx !== -1) {
          updatedScenesList[sceneIdx] = {
            ...updatedScenesList[sceneIdx],
            text: pageRes.roteiro,
            appliedStyleId: profileIdToGen,
          };
          onUpdateSceneText(updatedScenesList[sceneIdx].id, pageRes.roteiro);
        }
      });

      if (onSetScenes) {
        onSetScenes(updatedScenesList);
      } else if (onUpdateScene) {
        updatedScenesList.filter((s) => matchesChapter(s.chapterId)).forEach(onUpdateScene);
      }

      if (onUpdateMultiplePageScripts) {
        onUpdateMultiplePageScripts(batchScriptUpdates);
      } else {
        Object.entries(batchScriptUpdates).forEach(([k, v]) => onUpdatePageScript(k, v));
      }

      if (allFrameUpdates.length > 0) {
        onUpdateFrameSnippets(allFrameUpdates);
      }

      // Atualiza memória do capítulo
      if (currentChapter) {
        const memEntry = compileChapterMemoryEntry({
          chapter: currentChapter,
          chapterIndex: chapters.findIndex((c) => c.id === currentChapter.id),
          scenes: updatedScenesList,
          chapterMetadata: chapterMetadata[currentChapterId],
        });
        const updatedHistory = upsertProjectNarrativeHistory(projectMetadata.narrativeHistory || [], memEntry);
        onUpdateProjectMetadata({
          ...projectMetadata,
          narrativeHistory: updatedHistory,
        });
      }

      showToast(`⚡ Roteiro ("${currentProfile.name}") gerado via SOMENTE TEXTO para todas as ${res.paginas.length} páginas!`);
    } catch (err: any) {
      showToast(`Erro na estilização do roteiro: ${err?.message || 'Falha'}`);
    } finally {
      setIsBatchScriptGenerating(false);
      setBatchProgress(null);
    }
  };

  // FLUXO INTEGRADO: Se já houver extração, roda Etapa 2 pura (somente texto); senão, extrai e gera
  const handleBatchGenerateScript = async (targetProfileId?: string) => {
    if (isChapterContextExtracted) {
      await handleBatchGenerateScriptFromContext(targetProfileId);
    } else {
      await handleExtractChapterContext();
      await handleBatchGenerateScriptFromContext(targetProfileId);
    }
  };

  // Adicionar nova aba / perfil de roteiro
  const handleAddCustomProfile = () => {
    if (!newProfileName.trim()) return;

    const newId = `profile_custom_${Date.now()}`;
    const newProfile: ScriptProfile = {
      id: newId,
      name: newProfileName.trim(),
      systemPromptPreset: customPrompt.trim() || undefined,
      snippetsByFrameId: { ...activeProfile.snippetsByFrameId },
      fullScriptText: activeProfile.fullScriptText,
      createdAt: Date.now(),
    };

    updateCurrentScriptState({
      ...currentPageScriptState,
      activeProfileId: newId,
      profiles: [...currentPageScriptState.profiles, newProfile],
    });

    setNewProfileName('');
    setCustomPrompt('');
    setIsAddingCustomProfile(false);
    showToast(`Novo perfil "${newProfile.name}" criado!`);
  };

  // Avança para a tela de Narração consolidando os dados
  const handleProceedToNarration = () => {
    // Garante que o perfil ativo está salvo nos quadros e na cena
    const updates = currentPageFrames.map((f) => ({
      id: f.id,
      narrationSnippet: activeProfile.snippetsByFrameId[f.id] || '',
    }));
    onUpdateFrameSnippets(updates);

    if (currentPageScene) {
      onUpdateSceneText(currentPageScene.id, activeProfile.fullScriptText);
    }

    onNavigateTab('narracao');
  };

  const PROFILE_ICONS: Record<string, string> = {
    epico: '⚔️',
    sarcastico: '😏',
    cronista: '📜',
    tatico: '🎯',
    retencao: '⚡',
  };

  const handleOpenPromptModal = () => {
    const realPrompt =
      activeProfile.systemPromptPreset && activeProfile.systemPromptPreset.length > 80
        ? activeProfile.systemPromptPreset
        : buildChapterNarrationSystemPrompt(
            activeProfile.id,
            undefined,
            projectMetadata,
            chapterMetadata[currentChapterId]
          );
    setPromptEditText(realPrompt);
    setIsInspectPromptOpen(true);
  };

  const pageWordCount = (activeProfile.fullScriptText || '').trim()
    ? (activeProfile.fullScriptText || '').trim().split(/\s+/).length
    : 0;
  const pageEstimatedSec = (pageWordCount / 2.5).toFixed(1);

  // Estados e controle de redimensionamento das barras laterais
  const [leftSidebarWidth, setLeftSidebarWidth] = useState<number>(270);
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(340);
  const isDraggingLeftRef = useRef(false);
  const isDraggingRightRef = useRef(false);

  const handleLeftResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingLeftRef.current = true;
    const startX = e.clientX;
    const startWidth = leftSidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingLeftRef.current) return;
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.min(450, Math.max(200, startWidth + delta));
      setLeftSidebarWidth(newWidth);
    };

    const handlePointerUp = () => {
      isDraggingLeftRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleRightResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRightRef.current = true;
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingRightRef.current) return;
      const delta = startX - moveEvent.clientX; // arrastar para a esquerda aumenta a largura da sidebar direita
      const newWidth = Math.min(600, Math.max(240, startWidth + delta));
      setRightSidebarWidth(newWidth);
    };

    const handlePointerUp = () => {
      isDraggingRightRef.current = false;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-medium shadow-2xl animate-in fade-in slide-in-from-top-2">
          {toastMessage}
        </div>
      )}

      {/* CONTAINER PRINCIPAL TRIPLO (LAYOUT DE ESTÚDIO 3 COLUNAS) */}
      <div className="flex-1 flex overflow-hidden bg-background">
        {/* ======================================================== */}
        {/* BARRA LATERAL ESQUERDA: Configurações, Perfis e IA       */}
        {/* ======================================================== */}
        <aside
          style={{ width: `${leftSidebarWidth}px` }}
          className="shrink-0 h-full border-r border-border bg-card/60 flex flex-col overflow-hidden select-none"
        >
          {/* Cabeçalho da Sidebar Esquerda */}
          <div className="p-3 border-b border-border bg-card/40 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-bold text-foreground truncate">
                Roteiro & Perfis
              </span>
            </div>
            <button
              onClick={() => setIsMetadataDrawerOpen(true)}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              title="Configurar Personagens & Universo da Obra"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Corpo com Scroll da Sidebar Esquerda */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Bloco 0: Seletor de Capítulo Ativo */}
            {chapters.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  Capítulo ({chapters.length})
                </span>
                <select
                  value={currentChapterId}
                  onChange={(e) => {
                    onSelectChapter(e.target.value);
                    onSelectPage(1);
                  }}
                  className="w-full bg-secondary/80 text-foreground text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer truncate"
                >
                  {chapters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.label} ({ch.pages} pág{ch.pages !== 1 ? 's' : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Bloco 0.5: Continuidade Narrativa Entre Capítulos (se N > 1) */}
            {previousChapterMemory && (
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5 space-y-1.5 text-xs shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsContinuityExpanded(!isContinuityExpanded)}
                  className="w-full flex items-center justify-between text-left font-bold text-primary hover:underline cursor-pointer"
                  title="Clique para inspecionar os ganchos do capítulo anterior passados para a IA"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Link2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Continuidade: {previousChapterMemory.chapterLabel}</span>
                  </div>
                  <span className="text-[10px] font-mono opacity-80">{isContinuityExpanded ? '▲' : '▼'}</span>
                </button>
                {isContinuityExpanded && (
                  <div className="pt-2 border-t border-primary/20 space-y-1.5 text-[11px] text-foreground animate-in fade-in">
                    <div>
                      <span className="font-bold text-primary">Gancho Pendente:</span>
                      <p className="text-muted-foreground text-[10.5px] leading-relaxed mt-0.5">
                        {previousChapterMemory.endingHook || '(Continuação direta da ação)'}
                      </p>
                    </div>
                    {previousChapterMemory.lastSceneText && (
                      <div>
                        <span className="font-bold text-primary">Últimas Linhas:</span>
                        <p className="text-muted-foreground text-[10.5px] italic leading-tight mt-0.5 line-clamp-3">
                          "{previousChapterMemory.lastSceneText}"
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bloco 1: Bíblia do Capítulo e Pipeline em Duas Etapas */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Extração & Bíblia
                </span>
                {isChapterContextExtracted ? (
                  <span className="text-[9.5px] font-bold font-mono text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 rounded-full">
                    ✓ {extractedScenesCount}/{totalPages} Extraídas
                  </span>
                ) : (
                  <span className="text-[9.5px] font-bold font-mono text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.2 rounded-full">
                    Pendente
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handleAnalyzeChapterMacro}
                  disabled={isMacroAnalyzing || isBatchScriptGenerating || isScriptGenerating || isExtractingContext}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    chapterMetadata[currentChapterId]?.macroContext
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 shadow-2xs'
                      : 'bg-secondary/70 hover:bg-secondary text-foreground border-border'
                  }`}
                  title="Analisar Enredo Macro e Regras dos Personagens para impedir alucinações da IA"
                >
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-3.5 w-3.5" />
                    <span>
                      {chapterMetadata[currentChapterId]?.macroContext ? 'Bíblia Ativa' : 'Bíblia do Capítulo'}
                    </span>
                  </div>
                  {isMacroAnalyzing && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </button>

                {/* Se o capítulo já tem contexto extraído das imagens: oferece estilo rápido text-only */}
                {isChapterContextExtracted ? (
                  <>
                    <button
                      onClick={() => handleBatchGenerateScriptFromContext(activeProfile.id)}
                      disabled={isBatchScriptGenerating || isScriptGenerating || isExtractingContext}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
                      title="Gera/Reescreve o roteiro enviando SOMENTE TEXTO para a IA (Zero Imagens — Rápido e Barato)"
                    >
                      {isBatchScriptGenerating ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Estilizando Roteiro...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span>⚡ Aplicar Estilo (Somente Texto)</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleExtractChapterContext}
                      disabled={isBatchScriptGenerating || isScriptGenerating || isExtractingContext}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground text-[11px] font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                      title="Reanalisar as imagens do capítulo para atualizar diálogos e ações visuais"
                    >
                      {isExtractingContext ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Reextraindo Imagens...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3 w-3" />
                          <span>Reextrair das Imagens</span>
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleBatchGenerateScript(activeProfile.id)}
                      disabled={isBatchScriptGenerating || isScriptGenerating || isExtractingContext}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow-xs transition-colors disabled:opacity-40 cursor-pointer"
                      title="Executa a extração visual e gera o roteiro com o estilo selecionado"
                    >
                      {isBatchScriptGenerating || isExtractingContext ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Processando Capítulo...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Extrair & Gerar Roteiro</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleExtractChapterContext}
                      disabled={isBatchScriptGenerating || isScriptGenerating || isExtractingContext}
                      className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground text-[11px] font-semibold transition-colors disabled:opacity-40 cursor-pointer"
                      title="Extrai os diálogos e ações das imagens sem aplicar nenhum estilo"
                    >
                      {isExtractingContext ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Extraindo Contexto...</span>
                        </>
                      ) : (
                        <>
                          <FileSearch className="h-3 w-3" />
                          <span>Apenas Extrair Contexto Visual</span>
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Bloco 2: Perfis de Estilo de Narração */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Estilo de Narração
                </span>
                <button
                  onClick={() => setIsAddingCustomProfile(true)}
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                  title="Criar novo perfil de narração"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>

              <div className="space-y-1">
                {currentPageScriptState.profiles.map((profile) => {
                  const isActive = profile.id === activeProfile.id;
                  const isSelectedForNarration = profile.id === currentPageScriptState.activeProfileId;
                  const icon = PROFILE_ICONS[profile.id] || '🎙️';
                  const hasCache = Boolean(
                    profile.fullScriptText?.trim() ||
                    Object.values(profile.snippetsByFrameId || {}).some((s) => s?.trim())
                  );

                  return (
                    <button
                      key={profile.id}
                      onClick={() => handleSelectOrSwitchProfile(profile.id)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                        isActive
                          ? 'bg-primary/20 text-primary border-primary/40 shadow-xs'
                          : 'bg-secondary/40 text-muted-foreground border-transparent hover:text-foreground hover:bg-secondary'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="text-sm shrink-0">{icon}</span>
                        <span className="truncate">{profile.name}</span>
                        {hasCache && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Roteiro em cache pronto para restauração instantânea" />
                        )}
                      </div>
                      {isSelectedForNarration && (
                        <Star className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0 ml-1" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Popover / Form para Adicionar Novo Perfil */}
              {isAddingCustomProfile && (
                <div className="p-2.5 bg-secondary/80 border border-border rounded-lg flex flex-col gap-2 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-foreground">Novo Perfil</span>
                    <button
                      onClick={() => setIsAddingCustomProfile(false)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Nome do Perfil..."
                    value={newProfileName}
                    onChange={(e) => setNewProfileName(e.target.value)}
                    className="w-full bg-background text-foreground text-xs px-2 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={handleAddCustomProfile}
                    className="w-full py-1 rounded bg-primary text-primary-foreground text-xs font-semibold cursor-pointer"
                  >
                    Criar
                  </button>
                </div>
              )}
            </div>

            {/* Bloco 3: Configurações do Perfil Ativo */}
            <div className="space-y-2 p-2.5 rounded-lg bg-secondary/30 border border-border/50 text-xs">
              <div>
                <span className="font-bold text-foreground">{activeProfile.name}</span>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  {NARRATION_PROFILES.find((np) => np.id === activeProfile.id)?.description || 'Estilo de narração personalizado.'}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                <button
                  onClick={handleOpenPromptModal}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
                  title="Visualizar e editar as instruções completas enviadas à IA para este perfil"
                >
                  <Code2 className="h-3.5 w-3.5 text-sky-400" />
                  <span>Ver / Editar Prompt</span>
                </button>

                <button
                  onClick={() => handleGenerateScript(activeProfile.id)}
                  disabled={isScriptGenerating || isBatchScriptGenerating || currentPageFrames.length === 0}
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
                  title={`Gerar narração para a Página ${currentPageNumber} com este perfil`}
                >
                  {isScriptGenerating ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Gerando Pág. {currentPageNumber}...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Gerar Pág. {currentPageNumber}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Bloco 4: Barra de Progresso de Operações em Lote */}
            {batchProgress && (
              <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/25 flex flex-col gap-1.5 animate-in fade-in">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-primary truncate mr-1">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span className="truncate">{batchProgress.stage}</span>
                  </div>
                  <span className="text-[11px] font-bold text-primary shrink-0">
                    {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                  </span>
                </div>
                <div className="w-full bg-primary/20 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-300 rounded-full"
                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Bloco 5: Personagens Rápidos */}
            {projectMetadata.characters.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                  Personagens ({projectMetadata.characters.length})
                </span>
                <div className="flex flex-wrap gap-1">
                  {projectMetadata.characters.map((char) => (
                    <span
                      key={char.id}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-secondary/50 text-foreground border-border/60"
                    >
                      {char.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ======================================================== */}
        {/* RESIZER DIVIDER: ESQUERDA / CENTRO                       */}
        {/* ======================================================== */}
        <div
          onPointerDown={handleLeftResizeStart}
          className="w-1.5 hover:w-2 bg-transparent hover:bg-primary/50 cursor-col-resize transition-all shrink-0 z-10 select-none group flex items-center justify-center"
          title="Arrastar para redimensionar barra lateral esquerda"
        >
          <div className="w-[1px] h-8 bg-white/20 group-hover:bg-primary" />
        </div>

        {/* ======================================================== */}
        {/* PAINEL CENTRAL: Quadros da Página em 2 Colunas           */}
        {/* ======================================================== */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 bg-background">
          <div className="w-full flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Trechos por Quadro ({currentPageFrames.length} {currentPageFrames.length === 1 ? 'cena' : 'cenas'})
                </span>
                <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">
                  · Miniaturas com tags Set-of-Mark e durações individuais
                </span>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground">
                Página {currentPageNumber} de {totalPages}
              </span>
            </div>

            {currentPageFrames.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-border rounded-xl bg-card/40 flex flex-col items-center justify-center gap-3">
                <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Nenhum quadro recortado nesta página</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Vá para a aba <strong>Recorte</strong> para recortar os painéis desta página ou gerar recortes automáticos.
                  </p>
                </div>
                <button
                  onClick={() => onNavigateTab('recorte')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
                >
                  <span>Ir para Recorte</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 min-[1100px]:grid-cols-2 gap-3.5">
                {currentPageFrames.map((frame, idx) => {
                  const color = SOM_PALETTE[idx % SOM_PALETTE.length];
                  const snippet = activeProfile.snippetsByFrameId[frame.id] || '';
                  const isSelected = selectedFrameId === frame.id;
                  const wordCount = snippet.trim() ? snippet.trim().split(/\s+/).length : 0;
                  const estimatedSec = (wordCount / 2.5).toFixed(1);

                  return (
                    <div
                      key={frame.id}
                      ref={(el) => {
                        frameCardRefs.current[frame.id] = el;
                      }}
                      onClick={() => setSelectedFrameId(frame.id)}
                      className={`rounded-xl border p-3 bg-card/90 transition-all flex flex-col gap-2.5 ${
                        isSelected
                          ? 'border-primary ring-1 ring-primary shadow-lg shadow-black/20'
                          : 'border-border/80 hover:border-border'
                      }`}
                    >
                      {/* Header do Card */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color.border }}
                          />
                          <span className="text-xs font-bold text-foreground truncate">
                            {frame.label}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                            (Pág. {currentPageNumber})
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {wordCount} pal. · ~{estimatedSec}s
                          </span>
                        </div>
                      </div>

                      {/* Conteúdo: Miniatura + Textarea */}
                      <div className="flex flex-col sm:flex-row gap-3 items-start flex-1 min-w-0">
                        {/* Miniatura do Quadro */}
                        <div className="relative w-full sm:w-36 h-28 rounded-lg overflow-hidden bg-black/80 border border-white/10 shrink-0 flex items-center justify-center group shadow-xs">
                          {frame.src ? (
                            <img
                              src={frame.src}
                              alt={frame.label}
                              className="w-full h-full object-contain transition-transform group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-1 text-muted-foreground">
                              <ImageIcon className="h-5 w-5 opacity-40" />
                              <span className="text-[10px] font-mono">Sem imagem</span>
                            </div>
                          )}
                          <span
                            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold shadow-xs truncate max-w-[85%]"
                            style={{ backgroundColor: color.border, color: color.text }}
                          >
                            {frame.label}
                          </span>
                          <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-black/80 text-white border border-white/10">
                            {frame.duration?.toFixed(1) || '3.5'}s
                          </span>
                        </div>

                        {/* Narração do Quadro */}
                        <div className="flex-1 w-full flex flex-col gap-1.5 min-w-0 h-full">
                          <textarea
                            rows={4}
                            value={snippet}
                            onChange={(e) => handleFrameSnippetChange(frame.id, e.target.value)}
                            placeholder={`Narração para ${frame.label}...`}
                            className="w-full flex-1 min-h-[90px] bg-background/80 text-foreground text-xs p-2.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed font-sans placeholder:text-muted-foreground/50"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ======================================================== */}
        {/* RESIZER DIVIDER: CENTRO / DIREITA                        */}
        {/* ======================================================== */}
        <div
          onPointerDown={handleRightResizeStart}
          className="w-1.5 hover:w-2 bg-transparent hover:bg-primary/50 cursor-col-resize transition-all shrink-0 z-10 select-none group flex items-center justify-center"
          title="Arrastar para redimensionar barra lateral de roteiro"
        >
          <div className="w-[1px] h-8 bg-white/20 group-hover:bg-primary" />
        </div>

        {/* ======================================================== */}
        {/* BARRA LATERAL DIREITA: Roteiro Geral da Página           */}
        {/* ======================================================== */}
        <aside
          style={{ width: `${rightSidebarWidth}px` }}
          className="shrink-0 h-full border-l border-border bg-card/60 flex flex-col overflow-hidden select-none"
        >
          {/* Cabeçalho da Sidebar Direita */}
          <div className="p-3 border-b border-border bg-card/40 flex items-center justify-between shrink-0 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ScrollText className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-bold text-foreground truncate">
                Página {currentPageNumber}
              </span>
            </div>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/30 truncate shrink-0 max-w-[120px]">
              {rightSidebarTab === 'roteiro' ? activeProfile.name : 'Contexto Visual'}
            </span>
          </div>

          {/* Alternador de Abas: Roteiro Narrado vs. Contexto Extraído */}
          <div className="flex border-b border-border bg-card/70 p-1 gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setRightSidebarTab('roteiro')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                rightSidebarTab === 'roteiro'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              <ScrollText className="h-3.5 w-3.5" />
              <span>Roteiro</span>
            </button>
            <button
              type="button"
              onClick={() => setRightSidebarTab('contexto')}
              className={`flex-1 py-1.5 px-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                rightSidebarTab === 'contexto'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
              }`}
            >
              <FileSearch className="h-3.5 w-3.5" />
              <span>Contexto Extraído</span>
              {currentPageScene?.extractedContext && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="Contexto extraído pronto" />
              )}
            </button>
          </div>

          {rightSidebarTab === 'roteiro' ? (
            <>
              {/* Subheader / Ações de Distribuição e Métricas */}
              <div className="px-3 py-2 border-b border-border/40 bg-secondary/20 flex items-center justify-between shrink-0 text-[11px]">
                <span className="font-mono text-muted-foreground">
                  {pageWordCount} pal. · ~{pageEstimatedSec}s
                </span>
                <button
                  type="button"
                  onClick={() => handleDistributeToFrames()}
                  className="font-semibold text-primary hover:underline cursor-pointer flex items-center gap-1 transition-colors"
                  title="Distribuir o texto geral proporcionalmente entre os quadros da página"
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Distribuir</span>
                </button>
              </div>

              {/* Editor do Roteiro Geral Contínuo da Página */}
              <div className="flex-1 p-3 flex flex-col gap-2 overflow-hidden">
                <textarea
                  value={activeProfile.fullScriptText || ''}
                  onChange={(e) => handleFullScriptTextChange(e.target.value)}
                  placeholder={`Digite a narração contínua da Página ${currentPageNumber}...\n\nOu use 'Gerar Roteiro do Capítulo' na barra lateral esquerda para roteirizar via IA.`}
                  className="w-full flex-1 bg-background/80 text-foreground text-xs p-3 rounded-xl border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed font-sans placeholder:text-muted-foreground/50 shadow-inner"
                />
              </div>
            </>
          ) : (
            /* ABA 2: Contexto Extraído da Imagem (Fatos, Diálogos e Visual) */
            <div className="flex-1 p-3 flex flex-col gap-3 overflow-y-auto">
              {/* Aviso se houver divergência no número de quadros recortados */}
              {currentPageScene?.extractedContext?.frameCount &&
                currentPageFrames.length !== currentPageScene.extractedContext.frameCount && (
                  <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] leading-relaxed">
                    ⚠️ <strong>Divergência de Quadros:</strong> Há {currentPageFrames.length} quadros no Recorte, mas a extração visual possui {currentPageScene.extractedContext.frameCount}. Recomenda-se reextrair.
                  </div>
                )}

              {/* Informações da Cena */}
              <div className="space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Papel da Cena (Scene Beat)
                </span>
                <input
                  type="text"
                  value={currentPageScene?.extractedContext?.sceneBeat || ''}
                  onChange={(e) => handleUpdateExtractedContext('sceneBeat', e.target.value)}
                  placeholder="Ex: Abertura / Escalada de tensão / Clímax"
                  className="w-full bg-background/80 text-foreground text-xs px-2.5 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Personagens Presentes */}
              {currentPageScene?.extractedContext?.charactersInScene &&
                currentPageScene.extractedContext.charactersInScene.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Personagens em Cena
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {currentPageScene.extractedContext.charactersInScene.map((charName, cIdx) => (
                        <span
                          key={cIdx}
                          className="px-2 py-0.5 rounded-md bg-secondary text-foreground text-[10.5px] font-semibold border border-border"
                        >
                          {charName}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

              {/* Diálogos e Textos Brutos */}
              <div className="flex-1 flex flex-col gap-1 min-h-[140px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Diálogos e Textos Visíveis
                  </span>
                  <span className="text-[9.5px] text-muted-foreground font-mono">Editável</span>
                </div>
                <textarea
                  value={currentPageScene?.extractedContext?.rawDialoguesAndText || ''}
                  onChange={(e) => handleUpdateExtractedContext('rawDialoguesAndText', e.target.value)}
                  placeholder={`Diálogos e textos extraídos dos balões...\nEstruturado por [Quadro 01], [Quadro 02]...`}
                  className="w-full flex-1 bg-background/80 text-foreground text-xs p-2.5 rounded-xl border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed font-sans placeholder:text-muted-foreground/50 shadow-inner"
                />
              </div>

              {/* Descrição Visual Objetiva */}
              <div className="flex-1 flex flex-col gap-1 min-h-[140px]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Ação Visual & Expressões
                  </span>
                  <span className="text-[9.5px] text-muted-foreground font-mono">Editável</span>
                </div>
                <textarea
                  value={currentPageScene?.extractedContext?.visualDescription || ''}
                  onChange={(e) => handleUpdateExtractedContext('visualDescription', e.target.value)}
                  placeholder={`Descrição visual objetiva dos acontecimentos...\nEstruturado por [Quadro 01], [Quadro 02]...`}
                  className="w-full flex-1 bg-background/80 text-foreground text-xs p-2.5 rounded-xl border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-none leading-relaxed font-sans placeholder:text-muted-foreground/50 shadow-inner"
                />
              </div>
            </div>
          )}

          {/* Rodapé da Sidebar Direita */}
          <div className="p-2.5 border-t border-border/50 bg-card/40 text-[10px] text-muted-foreground flex items-center justify-between shrink-0">
            <span>{currentPageFrames.length} quadros na página</span>
            <span className="font-mono opacity-80">Pág. {currentPageNumber} de {totalPages}</span>
          </div>
        </aside>
      </div>

      {/* ======================================================== */}
      {/* TIMELINE DE PÁGINAS FIXA NO FOOTER (ESTILO RECORTE)      */}
      {/* ======================================================== */}
      <footer className="h-[74px] shrink-0 border-t border-white/10 bg-[#14151e]/95 backdrop-blur-xl flex items-center px-4 z-20 select-none">
        {totalPages > 0 && (
          <div
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
            className="w-full flex items-center gap-2 overflow-x-auto py-1 px-0.5 scrollbar-none"
          >
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageNum = idx + 1;
              const isSelected = pageNum === currentPageNumber;
              const pageFramesCount = frames.filter(
                (f) => (!f.chapterId || f.chapterId === currentChapterId) && Number(f.pageNumber) === pageNum
              ).length;
              const pageScriptKey = `${currentChapterId}_p${pageNum}`;
              const hasScript = Boolean(
                pageScripts[pageScriptKey]?.profiles?.some(
                  (p) => p.fullScriptText?.trim() || Object.values(p.snippetsByFrameId || {}).some((s) => s?.trim())
                )
              );
              const thumbUrl = chapterThumbnails[pageNum];

              return (
                <button
                  key={pageNum}
                  ref={isSelected ? activeThumbRef : null}
                  onClick={() => onSelectPage(pageNum)}
                  className={`group relative h-[60px] w-[40px] shrink-0 overflow-hidden rounded-lg border transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary/60 scale-105 shadow-md shadow-primary/25 z-10'
                      : 'border-white/10 opacity-70 hover:opacity-100 hover:border-white/30'
                  }`}
                  title={`Página ${pageNum} (${pageFramesCount} quadros${hasScript ? ', roteiro pronto' : ''})`}
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
                  {pageFramesCount > 0 && (
                    <span className="absolute top-0.5 right-0.5 bg-primary text-primary-foreground text-[8px] font-bold px-1 rounded shadow-xs leading-tight">
                      {pageFramesCount}
                    </span>
                  )}
                  {hasScript && (
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

      {/* ======================================================== */}
      {/* DRAWER LATERAL: Metadados da Obra & Personagens          */}
      {/* ======================================================== */}
      {isMetadataDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md bg-card border-l border-border h-full flex flex-col p-5 shadow-2xl animate-in slide-in-from-right-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">
                  Metadados da Obra & Personagens
                </h3>
              </div>
              <button
                onClick={() => setIsMetadataDrawerOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-4">
              {/* Título da Obra */}
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Título da Obra (Manhwa / Mangá)
                </label>
                <input
                  type="text"
                  value={projectMetadata.workTitle || ''}
                  onChange={(e) =>
                    onUpdateProjectMetadata({
                      ...projectMetadata,
                      workTitle: e.target.value,
                    })
                  }
                  placeholder="ex: Solo Leveling, Omniscient Reader"
                  className="w-full bg-background text-foreground text-xs px-3 py-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Sinopse do Capítulo */}
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Sinopse / Contexto deste Capítulo
                </label>
                <textarea
                  rows={2}
                  value={chapterMetadata[currentChapterId]?.synopsis || ''}
                  onChange={(e) =>
                    onUpdateChapterMetadata(currentChapterId, {
                      ...chapterMetadata[currentChapterId],
                      chapterId: currentChapterId,
                      synopsis: e.target.value,
                    })
                  }
                  placeholder="O que está acontecendo neste capítulo específico..."
                  className="w-full bg-background text-foreground text-xs p-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                />
              </div>

              {/* Bíblia Fática do Capítulo (Anti-Alucinação) */}
              <div className="p-3 rounded-lg border border-border bg-secondary/20 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-bold text-foreground">
                      Bíblia Fática do Capítulo
                    </span>
                  </div>
                  <button
                    onClick={handleAnalyzeChapterMacro}
                    disabled={isMacroAnalyzing}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50"
                  >
                    {isMacroAnalyzing ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Escaneando...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" />
                        <span>Escanear com IA</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Verdade dos Personagens / Esquadrão */}
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
                    Verdade dos Personagens / Esquadrão em Cena
                  </label>
                  <textarea
                    rows={2}
                    value={chapterMetadata[currentChapterId]?.macroContext?.characterDynamics || ''}
                    onChange={(e) => {
                      const cur = chapterMetadata[currentChapterId];
                      const curMacro = cur?.macroContext || {
                        synopsis: cur?.synopsis || '',
                        characterDynamics: '',
                        criticalRules: [],
                      };
                      onUpdateChapterMetadata(currentChapterId, {
                        ...cur,
                        chapterId: currentChapterId,
                        macroContext: {
                          ...curMacro,
                          characterDynamics: e.target.value,
                        },
                      });
                    }}
                    placeholder="ex: Veteranos assassinos insanos e muito fortes. Não são novatos nem preguiçosos."
                    className="w-full bg-background text-foreground text-xs p-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                </div>

                {/* Diretrizes Anti-Alucinação */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-muted-foreground">
                    Regras Anti-Alucinação ({chapterMetadata[currentChapterId]?.macroContext?.criticalRules?.length || 0})
                  </label>
                  <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                    {(chapterMetadata[currentChapterId]?.macroContext?.criticalRules || []).map((rule, rIdx) => (
                      <div
                        key={rIdx}
                        className="flex items-start gap-1.5 p-1.5 rounded bg-background border border-border text-[11px] text-foreground"
                      >
                        <span className="flex-1 leading-snug">{rule}</span>
                        <button
                          onClick={() => {
                            const cur = chapterMetadata[currentChapterId];
                            if (!cur?.macroContext) return;
                            const filtered = cur.macroContext.criticalRules.filter((_, idx) => idx !== rIdx);
                            onUpdateChapterMetadata(currentChapterId, {
                              ...cur,
                              macroContext: {
                                ...cur.macroContext,
                                criticalRules: filtered,
                              },
                            });
                          }}
                          className="text-muted-foreground hover:text-rose-400 p-0.5"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Adicionar regra manual */}
                  <div className="flex items-center gap-1.5 mt-1">
                    <input
                      type="text"
                      value={newCriticalRuleInput}
                      onChange={(e) => setNewCriticalRuleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newCriticalRuleInput.trim()) {
                          const cur = chapterMetadata[currentChapterId];
                          const curMacro = cur?.macroContext || {
                            synopsis: cur?.synopsis || '',
                            characterDynamics: '',
                            criticalRules: [],
                          };
                          onUpdateChapterMetadata(currentChapterId, {
                            ...cur,
                            chapterId: currentChapterId,
                            macroContext: {
                              ...curMacro,
                              criticalRules: [...curMacro.criticalRules, newCriticalRuleInput.trim()],
                            },
                          });
                          setNewCriticalRuleInput('');
                        }
                      }}
                      placeholder="Nova regra fática (Enter)..."
                      className="flex-1 bg-background text-foreground text-xs px-2 py-1 rounded border border-border"
                    />
                    <button
                      onClick={() => {
                        if (!newCriticalRuleInput.trim()) return;
                        const cur = chapterMetadata[currentChapterId];
                        const curMacro = cur?.macroContext || {
                          synopsis: cur?.synopsis || '',
                          characterDynamics: '',
                          criticalRules: [],
                        };
                        onUpdateChapterMetadata(currentChapterId, {
                          ...cur,
                          chapterId: currentChapterId,
                          macroContext: {
                            ...curMacro,
                            criticalRules: [...curMacro.criticalRules, newCriticalRuleInput.trim()],
                          },
                        });
                        setNewCriticalRuleInput('');
                      }}
                      className="px-2 py-1 rounded bg-secondary text-foreground text-xs hover:bg-secondary/80 border border-border"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Lista de Personagens */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Personagens Cadastrados ({projectMetadata.characters.length})
                  </label>
                  <button
                    onClick={() => {
                      const newChar: CharacterMetadata = {
                        id: `char_${Date.now()}`,
                        name: 'Novo Personagem',
                        aliases: [],
                        role: 'protagonist',
                      };
                      onUpdateProjectMetadata({
                        ...projectMetadata,
                        characters: [...projectMetadata.characters, newChar],
                      });
                    }}
                    className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div className="flex flex-col gap-2.5">
                  {projectMetadata.characters.map((char) => (
                    <div
                      key={char.id}
                      className="p-3 rounded-lg border border-border bg-background flex flex-col gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={char.name}
                          onChange={(e) => {
                            const updated = projectMetadata.characters.map((c) =>
                              c.id === char.id ? { ...c, name: e.target.value } : c
                            );
                            onUpdateProjectMetadata({
                              ...projectMetadata,
                              characters: updated,
                            });
                          }}
                          className="flex-1 bg-secondary/50 text-foreground text-xs font-bold px-2 py-1 rounded border border-border"
                        />
                        <select
                          value={char.role}
                          onChange={(e) => {
                            const updated = projectMetadata.characters.map((c) =>
                              c.id === char.id
                                ? { ...c, role: e.target.value as CharacterRole }
                                : c
                            );
                            onUpdateProjectMetadata({
                              ...projectMetadata,
                              characters: updated,
                            });
                          }}
                          className="bg-secondary text-foreground text-xs px-2 py-1 rounded border border-border"
                        >
                          <option value="protagonist">Protagonista</option>
                          <option value="ally">Aliado</option>
                          <option value="antagonist">Antagonista</option>
                          <option value="neutral">Neutro</option>
                        </select>
                        <button
                          onClick={() => {
                            const filtered = projectMetadata.characters.filter(
                              (c) => c.id !== char.id
                            );
                            onUpdateProjectMetadata({
                              ...projectMetadata,
                              characters: filtered,
                            });
                          }}
                          className="text-muted-foreground hover:text-rose-400 p-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={char.aliases.join(', ')}
                        onChange={(e) => {
                          const aliases = e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          const updated = projectMetadata.characters.map((c) =>
                            c.id === char.id ? { ...c, aliases } : c
                          );
                          onUpdateProjectMetadata({
                            ...projectMetadata,
                            characters: updated,
                          });
                        }}
                        placeholder="Alcunhas separadas por vírgula (ex: Jinwoo, Monarca)"
                        className="bg-secondary/30 text-foreground text-xs px-2 py-1 rounded border border-border/80"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-border flex justify-end">
              <button
                onClick={() => setIsMetadataDrawerOpen(false)}
                className="px-4 py-2 rounded bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: Inspecionar & Customizar Prompt do Perfil         */}
      {/* ======================================================== */}
      {isInspectPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="w-full max-w-3xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <Code2 className="h-5 w-5 text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Inspecionar & Personalizar Prompt do Perfil
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Perfil ativo: <strong className="text-foreground">{activeProfile.name}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsInspectPromptOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {/* Badges de regras */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="p-2.5 rounded-lg bg-secondary/50 border border-border flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Calibração Temporal
                  </span>
                  <span className="text-xs font-bold text-emerald-400">
                    12 a 22 palavras (~5.0s a 9.5s)
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-secondary/50 border border-border flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Ancoragem Visual
                  </span>
                  <span className="text-xs font-bold text-sky-400">
                    Set-of-Mark (SoM) Direto
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-secondary/50 border border-border flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                    Obra & Personagens
                  </span>
                  <span className="text-xs font-bold text-foreground truncate">
                    {projectMetadata.workTitle || 'Não especificada'} ({projectMetadata.characters.length} chars)
                  </span>
                </div>
              </div>

              {/* Textarea do System Prompt */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground">
                    Instruções do Sistema (System Prompt)
                  </label>
                  <button
                    onClick={() => {
                      const def = buildChapterNarrationSystemPrompt(
                        activeProfile.id,
                        undefined,
                        projectMetadata,
                        chapterMetadata[currentChapterId]
                      );
                      setPromptEditText(def);
                    }}
                    className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                  >
                    Restaurar Padrão do Preset
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Estas são as instruções exatas enviadas para o modelo multimodal de IA. Você pode editar o tom, orientações de vocabulário e regras específicas da sua obra.
                </p>
                <textarea
                  rows={13}
                  value={promptEditText}
                  onChange={(e) => setPromptEditText(e.target.value)}
                  className="w-full bg-background text-foreground font-mono text-xs p-3 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed resize-y"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-secondary/20 flex items-center justify-between">
              <span className="text-xs text-muted-foreground hidden sm:inline">
                As alterações serão aplicadas em todas as próximas gerações deste perfil.
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setIsInspectPromptOpen(false)}
                  className="px-3 py-1.5 rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    const updated = currentPageScriptState.profiles.map((p) =>
                      p.id === activeProfile.id
                        ? { ...p, systemPromptPreset: promptEditText }
                        : p
                    );
                    updateCurrentScriptState({
                      ...currentPageScriptState,
                      profiles: updated,
                    });
                    setIsInspectPromptOpen(false);
                    showToast(`Prompt do perfil "${activeProfile.name}" salvo com sucesso!`);
                  }}
                  className="px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow cursor-pointer"
                >
                  Salvar Prompt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
