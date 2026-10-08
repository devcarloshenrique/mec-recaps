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
} from '../types';
import {
  NARRATION_PROFILES,
  buildChapterNarrationSystemPrompt,
  analyzeChapterMacroContext,
  generateChapterNarrationInMiniBatches,
  generatePageNarrationWithVision,
  loadAiNarrationConfig,
  distributeTextToFrames,
  matchAiSceneToFrame,
  ChapterPageItem,
} from '../utils/aiNarration';

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
  onSelectChapter,
  onSelectPage,
  onNavigateTab,
}) => {
  // Estado local de navegação e visualização
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [leftViewMode, setLeftViewMode] = useState<'som' | 'sliced'>('som');
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

  // Imagem original da página atual (renderização sem memory leak)
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number }>({
    width: 1,
    height: 1,
  });

  const imgRef = useRef<HTMLImageElement | null>(null);
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

  // Estado do script da página atual com todos os 4 perfis nativos pré-carregados
  const currentPageScriptState: PageScriptState = useMemo(() => {
    const existing =
      pageScripts[pageScriptKey] ||
      (currentChapterId ? pageScripts[`${currentChapterId}_${currentPageNumber}`] : undefined) ||
      (currentChapter?.id ? pageScripts[`${currentChapter?.id}_${currentPageNumber}`] : undefined) ||
      pageScripts[`default_${currentPageNumber}`];

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
        systemPromptPreset: np.description,
        snippetsByFrameId: snippets,
        fullScriptText: fullText,
        createdAt: Date.now(),
      };
    });

    if (existing) {
      // Garante que todos os 4 perfis nativos estejam presentes mesmo em projetos antigos salvos
      const existingIds = new Set(existing.profiles.map((p) => p.id));
      const missingNative = NARRATION_PROFILES.filter((np) => !existingIds.has(np.id)).map((np) => ({
        id: np.id,
        name: np.name,
        systemPromptPreset: np.description,
        snippetsByFrameId: {},
        fullScriptText: '',
        createdAt: Date.now(),
      }));

      let mergedProfiles =
        missingNative.length > 0
          ? [...existing.profiles, ...missingNative]
          : existing.profiles;

      // Hidrata snippets e fullScriptText caso os quadros tenham narrationSnippet mas o perfil esteja vazio
      mergedProfiles = mergedProfiles.map((p) => {
        const updatedSnippets = { ...p.snippetsByFrameId };
        let hasChanges = false;
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

  // Marca um perfil como ATIVO ("⭐ Usar na Narração")
  const handleSetActiveProfile = (profileId: string) => {
    const targetProfile = currentPageScriptState.profiles.find((p) => p.id === profileId);
    if (!targetProfile) return;

    updateCurrentScriptState({
      ...currentPageScriptState,
      activeProfileId: profileId,
    });

    // Sincroniza os recortes e cena com o novo perfil ativo
    const updates: { id: string; narrationSnippet: string }[] = [];
    currentPageFrames.forEach((f) => {
      const snippet = targetProfile.snippetsByFrameId[f.id] || '';
      updates.push({ id: f.id, narrationSnippet: snippet });
    });

    onUpdateFrameSnippets(updates);
    if (currentPageScene) {
      onUpdateSceneText(currentPageScene.id, targetProfile.fullScriptText);
    }

    showToast(`Perfil "${targetProfile.name}" ativado para Narração!`);
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

  // GERAÇÃO EM MINI-BLOCOS DO CAPÍTULO (Todas as páginas com visão direta SoM e Bíblia Macro)
  const handleBatchGenerateScript = async (targetProfileId?: string) => {
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
        // Fallback: se o usuário ainda não recortou quadros específicos na página,
        // cria um quadro representando a página inteira para que toda a página receba roteiro!
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
      showToast('Nenhuma imagem encontrada no capítulo para gerar o roteiro.');
      return;
    }

    setIsBatchScriptGenerating(true);
    try {
      const res = await generateChapterNarrationInMiniBatches({
        chapterLabel: currentChapter?.label || 'Capítulo',
        pages: pagesWithFrames,
        profileId: profileIdToGen,
        customSystemPrompt: currentProfile.systemPromptPreset,
        projectMetadata,
        chapterMetadata: chapterMetadata[currentChapterId],
        batchSize: 2, // 2 páginas por mini-bloco
        concurrency: 2, // Processamento paralelo em dobro guiado pela Bíblia Macro
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

      if (res.macroContext) {
        onUpdateChapterMetadata(currentChapterId, {
          ...(chapterMetadata[currentChapterId] || { chapterId: currentChapterId }),
          chapterId: currentChapterId,
          synopsis: res.macroContext.synopsis || chapterMetadata[currentChapterId]?.synopsis || '',
          macroContext: res.macroContext,
        });
      }
      if (res.suggestedWorkTitle && !projectMetadata.workTitle) {
        onUpdateProjectMetadata({
          ...projectMetadata,
          workTitle: res.suggestedWorkTitle,
        });
      }
      if (
        res.detectedCharacters &&
        res.detectedCharacters.length > 0 &&
        projectMetadata.characters.length === 0
      ) {
        onUpdateProjectMetadata({
          ...projectMetadata,
          characters: res.detectedCharacters,
        });
      }

      const allFrameUpdates: { id: string; narrationSnippet: string; duration?: number; transition?: any }[] = [];
      const batchScriptUpdates: Record<string, PageScriptState> = {};

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

        // Salva com a chave canônica e todos os aliases conhecidos
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

        const scene = scenes.find(
          (s) =>
            matchesChapter(s.chapterId) &&
            Number(s.pageNumber) === pNum
        );
        if (scene) {
          onUpdateSceneText(scene.id, pageRes.roteiro);
        }
      });

      if (onUpdateMultiplePageScripts) {
        onUpdateMultiplePageScripts(batchScriptUpdates);
      } else {
        Object.entries(batchScriptUpdates).forEach(([k, v]) => onUpdatePageScript(k, v));
      }

      if (allFrameUpdates.length > 0) {
        onUpdateFrameSnippets(allFrameUpdates);
      }

      showToast(`Roteiro ("${currentProfile.name}") gerado com sucesso para todas as ${res.paginas.length} páginas!`);
    } catch (err: any) {
      showToast(`Erro na geração em lote: ${err?.message || 'Falha'}`);
    } finally {
      setIsBatchScriptGenerating(false);
      setBatchProgress(null);
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 right-6 z-50 px-4 py-2.5 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-100 text-xs font-medium shadow-2xl animate-in fade-in slide-in-from-top-2">
          {toastMessage}
        </div>
      )}

      {/* TOP BAR / METADATA SUMMARY & WORK INFO */}
      <div className="h-14 border-b border-border bg-card px-4 flex items-center justify-between shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Capítulo:
            </span>
            <select
              value={currentChapterId}
              onChange={(e) => onSelectChapter(e.target.value)}
              className="bg-secondary text-foreground text-xs font-medium px-2.5 py-1.5 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label} ({ch.pages} pág)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Página:
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={currentPageNumber <= 1}
                onClick={() => onSelectPage(currentPageNumber - 1)}
                className="p-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-bold text-foreground px-1.5">
                {currentPageNumber} / {totalPages}
              </span>
              <button
                disabled={currentPageNumber >= totalPages}
                onClick={() => onSelectPage(currentPageNumber + 1)}
                className="p-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-30 text-foreground cursor-pointer"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Work Title Badge */}
          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-border">
            <BookOpen className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-foreground">
              {projectMetadata.workTitle || 'Obra sem título'}
            </span>
          </div>

          {/* Character Badges */}
          <div className="hidden lg:flex items-center gap-1.5">
            {projectMetadata.characters.slice(0, 4).map((char) => {
              const roleColors = {
                protagonist: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
                antagonist: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
                ally: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
                neutral: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
              };
              return (
                <span
                  key={char.id}
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                    roleColors[char.role] || roleColors.neutral
                  }`}
                  title={`${char.name} (${char.role})`}
                >
                  {char.name}
                </span>
              );
            })}
            {projectMetadata.characters.length > 4 && (
              <span className="text-[10px] font-semibold text-muted-foreground">
                +{projectMetadata.characters.length - 4}
              </span>
            )}
          </div>
        </div>

        {/* Right Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalyzeChapterMacro}
            disabled={isMacroAnalyzing || isBatchScriptGenerating || isScriptGenerating}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
              chapterMetadata[currentChapterId]?.macroContext
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                : 'bg-secondary hover:bg-secondary/80 text-foreground border-border'
            }`}
            title="Analisar Enredo Macro e Regras dos Personagens (Bíblia do Capítulo) para impedir alucinações da IA"
          >
            {isMacroAnalyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Analisando Bíblia...</span>
              </>
            ) : (
              <>
                <BookOpen className="h-3.5 w-3.5" />
                <span>
                  {chapterMetadata[currentChapterId]?.macroContext ? 'Bíblia Ativa' : 'Bíblia do Capítulo'}
                </span>
              </>
            )}
          </button>

          <button
            onClick={() => setIsMetadataDrawerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
            title="Configurar nomes dos personagens, sinopse e termos do universo"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Personagens & Universo</span>
          </button>

          <button
            onClick={() => {
              setPromptEditText(
                activeProfile.systemPromptPreset ||
                buildChapterNarrationSystemPrompt(
                  activeProfile.id,
                  undefined,
                  projectMetadata,
                  chapterMetadata[currentChapterId]
                )
              );
              setIsInspectPromptOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary hover:bg-secondary/80 text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
            title="Visualizar e editar o prompt completo enviado à IA"
          >
            <Code2 className="h-3.5 w-3.5 text-sky-400" />
            <span className="hidden sm:inline">Ver / Editar Prompt</span>
          </button>

          <button
            onClick={() => handleBatchGenerateScript(activeProfile.id)}
            disabled={isBatchScriptGenerating || isScriptGenerating}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-2xs transition-colors disabled:opacity-40 cursor-pointer"
            title="Gerar o roteiro de todas as páginas do capítulo em mini-blocos guiados pela Bíblia Macro"
          >
            {isBatchScriptGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Gerando Capítulo...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                <span>Gerar Roteiro do Capítulo</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* MAIN SPLIT SCREEN VIEW */}
      <div className="flex-1 flex overflow-hidden">
        {/* ======================================================== */}
        {/* COLUNA ESQUERDA: Webtoon & Set-of-Mark Viewer (Página)   */}
        {/* ======================================================== */}
        <div className="w-1/2 border-r border-border flex flex-col bg-zinc-950/40 overflow-hidden">
          {/* Header da Coluna Esquerda */}
          <div className="h-10 px-3 border-b border-border bg-card/60 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Visualizador</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                {currentPageFrames.length} quadros
              </span>
            </div>

            <div className="flex items-center bg-secondary/60 rounded p-0.5 border border-border/60">
              <button
                onClick={() => setLeftViewMode('som')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  leftViewMode === 'som'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Página & SoM
              </button>
              <button
                onClick={() => setLeftViewMode('sliced')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                  leftViewMode === 'sliced'
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Modo Fatiado
              </button>
            </div>
          </div>

          {/* Área de Visualização */}
          <div className="flex-1 overflow-y-auto p-4 flex justify-center items-start">
            {leftViewMode === 'som' ? (
              /* MODO SET-OF-MARK: Imagem original com overlay SVG dinâmico (zero duplicate URLs) */
              <div className="relative inline-block max-w-full shadow-2xl rounded border border-border/80 overflow-hidden bg-black">
                {currentPageImageUrl ? (
                  <>
                    <img
                      ref={imgRef}
                      src={currentPageImageUrl}
                      alt={`Página ${currentPageNumber}`}
                      className="block max-w-full h-auto select-none pointer-events-none"
                      onLoad={(e) => {
                        const target = e.currentTarget;
                        setImgNaturalSize({
                          width: target.naturalWidth || 1,
                          height: target.naturalHeight || 1,
                        });
                      }}
                    />

                    {/* Overlay SVG dinâmico sobre a imagem (renderiza as molduras e tags) */}
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-auto"
                      viewBox={`0 0 ${imgNaturalSize.width} ${imgNaturalSize.height}`}
                      preserveAspectRatio="none"
                    >
                      {currentPageFrames.map((frame, idx) => {
                        if (!frame.cropRect) return null;
                        const { x, y, width, height } = frame.cropRect;
                        const color = SOM_PALETTE[idx % SOM_PALETTE.length];
                        const isSelected = selectedFrameId === frame.id;
                        const labelText = frame.label || `[Quadro ${String(idx + 1).padStart(2, '0')}]`;

                        // Posição da tag
                        const badgeWidth = Math.max(70, labelText.length * 9);
                        const badgeHeight = 22;
                        const badgeX = x + 4;
                        const badgeY = y > badgeHeight + 6 ? y - badgeHeight - 2 : y + 4;

                        return (
                          <g
                            key={frame.id}
                            className="cursor-pointer transition-opacity"
                            onClick={() => setSelectedFrameId(frame.id)}
                          >
                            {/* Borda Externa de Contraste */}
                            <rect
                              x={x}
                              y={y}
                              width={width}
                              height={height}
                              fill="none"
                              stroke="#000000"
                              strokeWidth={isSelected ? 10 : 6}
                            />
                            {/* Borda Colorida SoM */}
                            <rect
                              x={x}
                              y={y}
                              width={width}
                              height={height}
                              fill={isSelected ? `${color.border}22` : 'none'}
                              stroke={color.border}
                              strokeWidth={isSelected ? 6 : 3.5}
                            />

                            {/* Badge semi-translúcido da etiqueta */}
                            <rect
                              x={badgeX}
                              y={badgeY}
                              width={badgeWidth}
                              height={badgeHeight}
                              rx={4}
                              fill="rgba(0, 0, 0, 0.75)"
                              stroke={color.border}
                              strokeWidth={1.5}
                            />
                            <text
                              x={badgeX + badgeWidth / 2}
                              y={badgeY + 15}
                              textAnchor="middle"
                              fill="#FFFFFF"
                              fontSize="12"
                              fontWeight="bold"
                              fontFamily="sans-serif"
                            >
                              {labelText}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </>
                ) : (
                  <div className="p-12 text-center text-muted-foreground text-xs">
                    Nenhuma imagem carregada para a página {currentPageNumber}.
                  </div>
                )}
              </div>
            ) : (
              /* MODO FATIADO: Fita vertical dos recortes individuais já salvos em frame.src */
              <div className="w-full max-w-md flex flex-col gap-4">
                {currentPageFrames.map((frame, idx) => {
                  const isSelected = selectedFrameId === frame.id;
                  const color = SOM_PALETTE[idx % SOM_PALETTE.length];
                  return (
                    <div
                      key={frame.id}
                      onClick={() => setSelectedFrameId(frame.id)}
                      className={`rounded-lg border overflow-hidden bg-card cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary ring-2 ring-primary/40 shadow-lg'
                          : 'border-border hover:border-border/80'
                      }`}
                    >
                      <div className="h-7 px-3 bg-secondary/50 flex items-center justify-between text-xs font-semibold">
                        <span className="flex items-center gap-1.5" style={{ color: color.border }}>
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color.border }} />
                          {frame.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {frame.duration?.toFixed(1) || '3.5'}s
                        </span>
                      </div>
                      <div className="p-2 bg-black flex justify-center">
                        <img
                          src={frame.src}
                          alt={frame.label}
                          className="max-h-72 object-contain rounded"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ======================================================== */}
        {/* COLUNA DIREITA: Contexto Bruto & Perfis de Roteiro       */}
        {/* ======================================================== */}
        <div className="w-1/2 flex flex-col bg-background overflow-hidden">
          {/* Header da Coluna Direita: Tabs de Perfis de Roteiro */}
          <div className="h-10 px-3 border-b border-border bg-card/60 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {currentPageScriptState.profiles.map((profile) => {
                const isActiveTab = profile.id === activeProfile.id;
                const isSelectedForNarration = profile.id === currentPageScriptState.activeProfileId;
                return (
                  <button
                    key={profile.id}
                    onClick={() => {
                      updateCurrentScriptState({
                        ...currentPageScriptState,
                        activeProfileId: profile.id,
                      });
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer shrink-0 ${
                      isActiveTab
                        ? 'bg-secondary text-foreground font-semibold border border-border shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span>{profile.name}</span>
                    {isSelectedForNarration && (
                      <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                    )}
                  </button>
                );
              })}

              <button
                onClick={() => setIsAddingCustomProfile(true)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer"
                title="Criar novo perfil de narração"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>

              <button
                onClick={() => {
                  setPromptEditText(
                    activeProfile.systemPromptPreset ||
                    buildChapterNarrationSystemPrompt(
                      activeProfile.id,
                      undefined,
                      projectMetadata,
                      chapterMetadata[currentChapterId]
                    )
                  );
                  setIsInspectPromptOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary border border-border/60 transition-colors cursor-pointer shrink-0 ml-1"
                title="Visualizar e editar o prompt completo enviado à IA para este perfil"
              >
                <Code2 className="h-3 w-3 text-sky-400" />
                <span>Ver Prompt</span>
              </button>
            </div>

            {/* Ações da Aba Ativa */}
            <div className="flex items-center gap-1.5 shrink-0">
              {currentPageScriptState.activeProfileId !== activeProfile.id ? (
                <button
                  onClick={() => handleSetActiveProfile(activeProfile.id)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium transition-colors cursor-pointer"
                  title="Definir este perfil para ser usado na tela de Narração"
                >
                  <Star className="h-3 w-3" />
                  <span>Usar na Narração</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold">
                  <Check className="h-3 w-3" />
                  <span>Ativo</span>
                </span>
              )}

              {/* Gerar Roteiro Apenas da Página Atual */}
              <button
                onClick={() => handleGenerateScript(activeProfile.id)}
                disabled={isScriptGenerating || isBatchScriptGenerating}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 border border-border text-foreground text-xs font-medium shadow-2xs transition-colors disabled:opacity-40 cursor-pointer"
                title={`Gerar roteiro com visão direta apenas para a Página ${currentPageNumber}`}
              >
                {isScriptGenerating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span>Gerando...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 text-sky-400" />
                    <span>Gerar Pág. {currentPageNumber}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Barra de Progresso de Operações em Lote */}
          {batchProgress && (
            <div className="mx-3 mt-2 p-2.5 rounded-lg bg-primary/10 border border-primary/25 flex flex-col gap-1.5 animate-in fade-in shrink-0">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-primary truncate mr-2">
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

          {/* Modal / Popover para Adicionar Novo Perfil */}
          {isAddingCustomProfile && (
            <div className="p-3 bg-secondary/80 border-b border-border flex flex-col gap-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">Novo Perfil de Estilo</span>
                <button
                  onClick={() => setIsAddingCustomProfile(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nome do Perfil (ex: Sarcástico / Recap Rápido)"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  className="flex-1 bg-background text-foreground text-xs px-2.5 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={handleAddCustomProfile}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-semibold cursor-pointer"
                >
                  Criar
                </button>
              </div>
              <input
                type="text"
                placeholder="Instrução de tom opcional (ex: Destaque a comédia e quebre a 4ª parede)"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                className="w-full bg-background text-foreground text-xs px-2.5 py-1.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {/* Conteúdo com Scroll da Coluna Direita */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* SEÇÃO: Roteiro Completo Unificado da Página */}
            <div className="rounded-lg border border-border bg-card p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">
                  Roteiro Contínuo da Página ({activeProfile.name})
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Edição sincronizada com os quadros
                </span>
              </div>
              <textarea
                rows={3}
                value={activeProfile.fullScriptText || ''}
                onChange={(e) => handleFullScriptTextChange(e.target.value)}
                placeholder="Texto narrativo completo desta página..."
                className="w-full bg-background text-foreground text-xs p-2.5 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
              />
            </div>

            {/* SEÇÃO: Cards de Roteiro por Quadro (Snippets) */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-foreground">
                Trechos por Quadro (Timeline de Narração)
              </span>

              {currentPageFrames.map((frame, idx) => {
                const color = SOM_PALETTE[idx % SOM_PALETTE.length];
                const snippet = activeProfile.snippetsByFrameId[frame.id] || '';
                const isSelected = selectedFrameId === frame.id;

                return (
                  <div
                    key={frame.id}
                    ref={(el) => {
                      frameCardRefs.current[frame.id] = el;
                    }}
                    onClick={() => setSelectedFrameId(frame.id)}
                    className={`rounded-lg border p-3 flex flex-col gap-2 bg-card transition-all ${
                      isSelected
                        ? 'border-primary ring-1 ring-primary shadow-md'
                        : 'border-border hover:border-border/80'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: color.border }}
                        />
                        <span className="text-xs font-bold text-foreground">
                          {frame.label}
                        </span>
                      </div>

                      <span className="text-[10px] text-muted-foreground">
                        {frame.duration?.toFixed(1) || '3.5'}s
                      </span>
                    </div>

                    <textarea
                      rows={2}
                      value={snippet}
                      onChange={(e) => handleFrameSnippetChange(frame.id, e.target.value)}
                      placeholder={`Narração específica para o ${frame.label}...`}
                      className="w-full bg-background text-foreground text-xs p-2 rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary resize-y leading-relaxed"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* FOOTER BAR: Navegação entre Telas */}
      <div className="h-14 border-t border-border bg-card px-4 flex items-center justify-between shrink-0">
        <button
          onClick={() => onNavigateTab('recorte')}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-md border border-border bg-secondary hover:bg-secondary/80 text-foreground text-xs font-semibold transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar ao Recorte</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Perfil ativo: <strong className="text-foreground">{activeProfile.name}</strong>
          </span>
          <button
            onClick={handleProceedToNarration}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold shadow transition-colors cursor-pointer"
          >
            <span>Avançar para Narração</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

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
