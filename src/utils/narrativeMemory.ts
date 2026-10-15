import {
  ChapterItem,
  ChapterMetadata,
  ChapterNarrativeMemory,
  SceneItem,
} from '../types';

/**
 * Compila a memória narrativa de um capítulo a partir de suas cenas e metadados.
 * Se campos específicos não foram preenchidos manualmente pelo usuário, deriva
 * de forma defensiva a partir dos textos das cenas e do contexto extraído.
 */
export function compileChapterMemoryEntry(params: {
  chapter: ChapterItem;
  chapterIndex: number;
  scenes: SceneItem[];
  chapterMetadata?: ChapterMetadata;
}): ChapterNarrativeMemory {
  const { chapter, chapterIndex, scenes, chapterMetadata } = params;

  // Filtra as cenas pertencentes a este capítulo
  const chapterScenes = scenes
    .filter((s) => !s.chapterId || s.chapterId === chapter.id)
    .sort((a, b) => Number(a.pageNumber || 0) - Number(b.pageNumber || 0));

  // Últimas cenas válidas com texto
  const scenesWithText = chapterScenes.filter((s) => s.text && s.text.trim().length > 0);
  const lastScene = scenesWithText[scenesWithText.length - 1];
  const secondLastScene = scenesWithText.length > 1 ? scenesWithText[scenesWithText.length - 2] : null;

  let lastSceneText = '';
  if (lastScene) {
    if (secondLastScene && secondLastScene.text) {
      lastSceneText = `${secondLastScene.text.trim()} [...] ${lastScene.text.trim()}`;
    } else {
      lastSceneText = lastScene.text.trim();
    }
  }

  // Sinopse
  let synopsis = chapterMetadata?.synopsis?.trim() || chapterMetadata?.macroContext?.synopsis?.trim() || '';
  if (!synopsis && chapterScenes.length > 0) {
    // Derivação automática resumida das primeiras e últimas páginas
    const samples = chapterScenes
      .map((s) => s.text?.trim() || s.extractedContext?.visualDescription?.trim() || '')
      .filter(Boolean)
      .slice(0, 3);
    if (samples.length > 0) {
      synopsis = samples.join(' ').slice(0, 280) + '...';
    }
  }

  // Gancho final (endingHook)
  let endingHook = chapterMetadata?.endingHook?.trim() || '';
  if (!endingHook && lastScene) {
    if (lastScene.extractedContext?.sceneBeat) {
      endingHook = `Gancho visual: ${lastScene.extractedContext.sceneBeat}`;
    } else if (lastScene.text) {
      // Pega a última oração do texto
      const sentences = lastScene.text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
      endingHook = sentences[sentences.length - 1] || lastScene.text.slice(0, 100);
    }
  }

  // Estado da trama (narrativeState)
  let narrativeState = chapterMetadata?.narrativeState?.trim() || '';
  if (!narrativeState && chapterMetadata?.macroContext?.characterDynamics) {
    narrativeState = chapterMetadata.macroContext.characterDynamics.slice(0, 200);
  }

  const keyOutcomes = chapterMetadata?.keyOutcomes || [];

  return {
    chapterId: chapter.id,
    chapterIndex,
    chapterLabel: chapter.label || `Capítulo ${chapterIndex + 1}`,
    synopsis: synopsis || `Eventos do ${chapter.label || 'capítulo'}`,
    endingHook: endingHook || 'Transição contínua para os próximos acontecimentos.',
    narrativeState: narrativeState || 'Acontecimentos concluídos com gancho aberto.',
    lastSceneText: lastSceneText || undefined,
    keyOutcomes,
    updatedAt: Date.now(),
  };
}

/**
 * Atualiza ou insere ordenadamente a memória do capítulo no histórico do projeto.
 */
export function upsertProjectNarrativeHistory(
  history: ChapterNarrativeMemory[] = [],
  entry: ChapterNarrativeMemory
): ChapterNarrativeMemory[] {
  const existingIdx = history.findIndex((h) => h.chapterId === entry.chapterId);
  const next = [...history];

  if (existingIdx !== -1) {
    next[existingIdx] = entry;
  } else {
    next.push(entry);
  }

  // Ordena cronologicamente por chapterIndex
  return next.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

/**
 * Localiza a memória do capítulo imediatamente anterior (N - 1) na ordem atual dos capítulos.
 */
export function resolvePreviousChapterMemory(params: {
  chapters: ChapterItem[];
  currentChapterId: string;
  narrativeHistory?: ChapterNarrativeMemory[];
  scenes?: SceneItem[];
  chapterMetadata?: Record<string, ChapterMetadata>;
}): ChapterNarrativeMemory | null {
  const { chapters, currentChapterId, narrativeHistory = [], scenes = [], chapterMetadata = {} } = params;

  const currentIdx = chapters.findIndex((c) => c.id === currentChapterId);
  if (currentIdx <= 0) {
    // Primeiro capítulo não possui anterior
    return null;
  }

  const prevChapter = chapters[currentIdx - 1];
  if (!prevChapter) return null;

  // Busca no histórico
  const fromHistory = narrativeHistory.find((h) => h.chapterId === prevChapter.id);
  if (fromHistory) {
    return fromHistory;
  }

  // Se não estiver no histórico, compila sob demanda
  return compileChapterMemoryEntry({
    chapter: prevChapter,
    chapterIndex: currentIdx - 1,
    scenes,
    chapterMetadata: chapterMetadata[prevChapter.id],
  });
}

/**
 * Formata o bloco de injeção de prompt com a continuidade do capítulo anterior.
 */
export function formatContinuityPromptBlock(prevMemory: ChapterNarrativeMemory): string {
  const lines: string[] = [
    `[MEMÓRIA DE CONTINUIDADE NARRATIVA - CAPÍTULO ANTERIOR]`,
    `- Capítulo Anterior: ${prevMemory.chapterLabel}`,
    `- Sinopse do Capítulo Anterior: ${prevMemory.synopsis || '(Não informada)'}`,
    `- Estado da Trama / Consequências: ${prevMemory.narrativeState || '(Em andamento)'}${
      prevMemory.keyOutcomes && prevMemory.keyOutcomes.length > 0
        ? ` | Consequências Diretas: ${prevMemory.keyOutcomes.join('; ')}`
        : ''
    }`,
    `- Gancho / Cliffhanger Pendente: ${prevMemory.endingHook || '(Continuação direta da ação)'}`,
  ];

  if (prevMemory.lastSceneText) {
    lines.push(`- Últimas Linhas Narradas no Capítulo Anterior: "${prevMemory.lastSceneText}"`);
  }

  lines.push(
    `- DIRETRIZ MANDATÓRIA DE TRANSIÇÃO: Conecte o início deste novo capítulo de forma fluida, orgânica e direta com os eventos finais do capítulo anterior. Não reintroduza personagens que já estavam em cena como se fossem desconhecidos e mantenha total coerência com o gancho pendente.`
  );

  return lines.join('\n');
}
