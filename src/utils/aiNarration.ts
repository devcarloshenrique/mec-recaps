/**
 * AI & Smart Script Generator for Manga/Manhwa Recaps
 * Generates compelling YouTube-style recap narrations from raw page images.
 * Powered by OpenAI-compatible vision endpoints (9router, local LLMs, or cloud models).
 */

import {
  FrameItem,
  SceneItem,
  TransitionType,
  ProjectMetadata,
  ChapterMetadata,
  ChapterMacroContext,
  CharacterMetadata,
} from '../types';
import { generateSoMAnnotatedPage } from './somAnnotator';

export function normalizeTransitionType(rawTrans: string, index: number = 0): TransitionType {
  const t = String(rawTrans || '').toLowerCase().trim();
  if (t === 'zoom_in' || t.includes('zoom_in') || t.includes('zoom in') || t === 'in') return 'zoom_in';
  if (t === 'zoom_out' || t.includes('zoom_out') || t.includes('zoom out') || t === 'out') return 'zoom_out';
  if (t.includes('pan')) return 'pan_down';
  if (t.includes('fade')) return 'fade';
  if (t.includes('cut') || t.includes('corte')) return 'cut';
  return index % 2 === 0 ? 'zoom_in' : 'zoom_out';
}

export interface NarrationProfile {
  id: string;
  name: string;
  label: string;
  description: string;
  systemDescription: string;
}

export const NARRATION_PROFILES: NarrationProfile[] = [
  {
    id: 'sarcastico',
    name: 'Cúmplice & Sarcástico',
    label: '😏 Cúmplice & Sarcástico',
    description: 'Comentários cínicos, quebra da quarta parede, piadas com clichês',
    systemDescription:
      'Cúmplice & Sarcástico: Debochado, fala com o espectador, tira sarro da arrogância dos vilões e celebra o contra-ataque do prota.',
  },
  {
    id: 'epico',
    name: 'Cronista Épico',
    label: '⚔️ Cronista Épico',
    description: 'Cinematográfico, solene, foco na tensão e impacto das lutas',
    systemDescription:
      'Cronista Épico: Dramático, cinematográfico, usa pausas e vocabulário solene, focado no peso dramático de cada golpe.',
  },
  {
    id: 'tatico',
    name: 'Analista Tático',
    label: '🧠 Analista Tático',
    description: 'Frio, calculista, foco nas mecânicas, ranks e estratégias',
    systemDescription:
      'Analista Tático: Foco na frieza do prota, dedução das fraquezas do oponente e explicação rápida das regras de poder/sistema.',
  },
  {
    id: 'dinamico',
    name: 'Dinâmico de Retenção',
    label: '⚡ Dinâmico de Retenção',
    description: 'Ritmo acelerado, ganchos a cada frase, estilo YouTube/Shorts',
    systemDescription:
      'Dinâmico de Retenção: Frases curtas, ritmo frenético, inserindo ganchos contínuos ("Mas o pior ainda estava por vir...").',
  },
];

// Presets compatibility alias
export interface ScriptPreset {
  id: string;
  name: string;
  icon: string;
  description: string;
  tonePrompt: string;
  samplePrefix: string;
}

export const SCRIPT_PRESETS: ScriptPreset[] = NARRATION_PROFILES.map((p) => ({
  id: p.id,
  name: p.name,
  icon: p.label.split(' ')[0] || '🎙️',
  description: p.description,
  tonePrompt: p.systemDescription,
  samplePrefix: p.systemDescription,
}));

export interface AiNarrationConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  stylePreset: string;
  ttsModel?: string;
  temperature?: number;
}

export const AVAILABLE_MODELS = [
  {
    id: 'ag/gemini-3.8-flash-high',
    name: 'Gemini 3.8 Flash High (Recomendado)',
    badge: 'Visão Rápida & Alta Precisão',
  },
  {
    id: 'ag/gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    badge: 'Ultra Rápido',
  },
  {
    id: 'ag/gemini-3.7-flash-medium',
    name: 'Gemini 3.7 Flash Medium',
    badge: 'Equilibrado',
  },
  {
    id: 'ag/claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    badge: 'Narrativa Profunda',
  },
  {
    id: 'ag/claude-opus-4-6-thinking',
    name: 'Claude Opus 4.6 Thinking',
    badge: 'Raciocínio Máximo',
  },
];

export const AVAILABLE_TTS_MODELS = [
  {
    id: 'edge-tts/pt-BR-AntonioNeural',
    name: 'Antônio Neural (pt-BR Masculino / Narrador)',
    badge: 'Padrão Edge-TTS',
  },
  {
    id: 'edge-tts/pt-BR-FranciscaNeural',
    name: 'Francisca Neural (pt-BR Feminino / Natural)',
    badge: 'Edge-TTS',
  },
  {
    id: 'edge-tts/pt-BR-ThalitaNeural',
    name: 'Thalita Neural (pt-BR Feminino / Jovem)',
    badge: 'Edge-TTS',
  },
  {
    id: 'edge-tts/pt-BR-FabioNeural',
    name: 'Fábio Neural (pt-BR Masculino / Grave)',
    badge: 'Edge-TTS',
  },
  {
    id: 'gemini/gemini-3.1-flash-tts-preview/Fenrir',
    name: 'Fenrir (Voz Masculina Grave / Narrador Recap)',
    badge: 'Gemini TTS',
  },
  {
    id: 'gemini/gemini-3.1-flash-tts-preview/Puck',
    name: 'Puck (Voz Masculina Dinâmica / Enérgica)',
    badge: 'Gemini TTS',
  },
  {
    id: 'gemini/gemini-3.1-flash-tts-preview/Charon',
    name: 'Charon (Voz Profunda & Solene)',
    badge: 'Épico',
  },
  {
    id: 'gemini/gemini-3.1-flash-tts-preview/Aoede',
    name: 'Aoede (Voz Feminina Expressiva)',
    badge: 'Natural',
  },
  {
    id: 'gemini/gemini-3.1-flash-tts-preview/Kore',
    name: 'Kore (Voz Feminina Suave & Tensa)',
    badge: 'Cinematográfico',
  },
];

const ENV_BASE_URL = (import.meta.env.VITE_AI_BASE_URL as string)?.trim() || 'http://localhost:20128/v1';
const ENV_API_KEY = (import.meta.env.VITE_AI_API_KEY as string)?.trim() || '';
const ENV_MODEL = (import.meta.env.VITE_AI_MODEL as string)?.trim() || 'ag/gemini-3.8-flash-high';
const ENV_TTS_MODEL = (import.meta.env.VITE_AI_TTS_MODEL as string)?.trim() || 'edge-tts/pt-BR-AntonioNeural';

export const DEFAULT_AI_CONFIG: AiNarrationConfig = {
  provider: '9router',
  baseURL: ENV_BASE_URL,
  apiKey: ENV_API_KEY,
  model: ENV_MODEL,
  ttsModel: ENV_TTS_MODEL,
  stylePreset: 'sarcastico',
  temperature: 0.72,
};

const STORAGE_KEY_CONFIG = 'mec_recap_ai_config';

export function loadAiNarrationConfig(): AiNarrationConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Limpa URLs antigas de túneis temporários ou legados
      if (parsed.baseURL && parsed.baseURL.includes('abc-tunnel.us')) {
        parsed.baseURL = DEFAULT_AI_CONFIG.baseURL;
      }
      // Se a chave salva for o token de teste antigo, migra para o valor configurado
      if (parsed.apiKey === 'sk-9f0701a12df427ea-ktrke6-b72acfe0') {
        parsed.apiKey = DEFAULT_AI_CONFIG.apiKey;
      }
      // Migrate legacy default gemini voice to the requested edge-tts AntonioNeural
      let ttsModel = parsed.ttsModel || DEFAULT_AI_CONFIG.ttsModel;
      if (!ttsModel || ttsModel.includes('gemini-3.1-flash-tts-preview/Fenrir')) {
        ttsModel = DEFAULT_AI_CONFIG.ttsModel;
      }
      return {
        ...DEFAULT_AI_CONFIG,
        ...parsed,
        baseURL: parsed.baseURL || DEFAULT_AI_CONFIG.baseURL,
        apiKey: parsed.apiKey ?? DEFAULT_AI_CONFIG.apiKey,
        model: parsed.model || DEFAULT_AI_CONFIG.model,
        ttsModel,
      };
    }
  } catch {}
  return { ...DEFAULT_AI_CONFIG };
}

export function saveAiNarrationConfig(config: AiNarrationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(config));
  } catch {}
}

/**
 * Calculates realistic TTS speech duration proportional to YouTube recap pacing (2.4 words/second).
 * Calibrated for detailed narration between 5.0s and 10.0s per panel.
 */
export function calculateRequiredSpeechDuration(text: string): number {
  if (!text || text.trim().length === 0) return 6.0; // fallback padrão

  // Limpa espaços extras e conta palavras reais
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // 1. Velocidade base realista para narração de recap (2.4 palavras/segundo)
  const WORDS_PER_SECOND = 2.4;
  let duration = wordCount / WORDS_PER_SECOND;

  // 2. Pausas sutis para pontuação expressiva
  const commas = (text.match(/,/g) || []).length;
  const periods = (text.match(/[.!?]/g) || []).length;
  duration += (commas * 0.15) + (periods * 0.3);

  // 3. Limites calibrados para recap de 5.0s a 10.0s
  const MIN_DURATION = 5.0; // Mínimo de 5.0s para evitar cortes prematuros
  const MAX_DURATION = 10.0; // Teto de 10.0s conforme autorizado pelo usuário

  return Math.min(Math.max(Number(duration.toFixed(1)), MIN_DURATION), MAX_DURATION);
}

/**
 * Calculates approximate speech duration in seconds and formatted MM:SS
 */
export function estimateNarrationDuration(
  text: string,
  wordsPerMinute: number = 120
): { seconds: number; formatted: string; wordCount: number } {
  const words = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  if (words === 0) return { seconds: 0, formatted: '0:00', wordCount: 0 };

  const pausesCount = (text.match(/[,.;:!?…—–]/g) || []).length;
  const rawSeconds = (words / wordsPerMinute) * 60 + pausesCount * 0.25;
  const seconds = Math.max(3, Math.round(rawSeconds));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return {
    seconds,
    formatted: `${mins}:${String(secs).padStart(2, '0')}`,
    wordCount: words,
  };
}

/**
 * Passo A: Consolidação do Texto
 * Concatena os trechos de cada cena ou o roteiro completo da página,
 * inserindo pausas naturais (...) entre as transições de quadro.
 */
export function consolidatePageNarrationText(
  pageText: string,
  frames?: { narrationSnippet?: string }[]
): string {
  const snippets = (frames || [])
    .map((f) => (f.narrationSnippet || '').trim())
    .filter(Boolean);

  if (snippets.length > 0) {
    // Insere pausas expressivas entre as transições de quadro
    return snippets.join('... ');
  }

  return (pageText || '').trim();
}

/**
 * Passo C: Medição de Duração Real do Áudio
 * Extrai a propriedade exata audio.duration (em segundos) assim que o evento loadedmetadata
 * for disparado, com fallback de AudioContext para decodificação precisa por amostra.
 */
export async function getAudioBlobDuration(blob: Blob): Promise<number> {
  const attemptAudioElement = (): Promise<number> => {
    return new Promise((resolve, reject) => {
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.preload = 'metadata';

      const cleanUp = () => {
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
        URL.revokeObjectURL(audioUrl);
      };

      const onLoaded = () => {
        const d = audio.duration;
        cleanUp();
        if (!isNaN(d) && isFinite(d) && d > 0) {
          resolve(d);
        } else {
          reject(new Error('Invalid duration'));
        }
      };

      const onError = () => {
        cleanUp();
        reject(new Error('Audio load error'));
      };

      audio.addEventListener('loadedmetadata', onLoaded);
      audio.addEventListener('error', onError);
      audio.src = audioUrl;

      setTimeout(() => {
        cleanUp();
        reject(new Error('Audio load timeout'));
      }, 3500);
    });
  };

  try {
    const dur = await attemptAudioElement();
    return Number(dur.toFixed(2));
  } catch {
    return decodeAudioDataDuration(blob);
  }
}

async function decodeAudioDataDuration(blob: Blob): Promise<number> {
  const AudioContextClass =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as any).webkitAudioContext
      : null;
  if (!AudioContextClass) return 3.0;
  const ctx = new AudioContextClass();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration;
    ctx.close();
    return Number(duration.toFixed(2));
  } catch {
    try {
      ctx.close();
    } catch {}
    return 3.0;
  }
}

/**
 * Calcula os pesos fonéticos de um trecho de texto considerando palavras,
 * comprimento de caracteres e pausas naturais de pontuação (vírgulas, pontos).
 */
export function estimateTextPhoneticWeight(text: string): number {
  if (!text || !text.trim()) return 0;
  const clean = text.trim();

  const words = clean.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return 0;

  // Caracteres sem espaços
  const charCount = clean.replace(/\s+/g, '').length;

  // Pausas curtas (vírgulas, dois pontos, ponto e vírgula, travessões)
  const shortPauses = (clean.match(/[,;:\-—–]/g) || []).length;

  // Pausas longas de término de frase (pontos finais, exclamações, interrogações, reticências)
  const longPauses = (clean.match(/(\.{3}|\.|\!|\?|\n+)/g) || []).length;

  // Fórmula empírica alinhada à cadência de modelos neurais TTS (Edge-TTS / OpenAI)
  // Palavras base + peso por caracteres + peso proporcional das pausas acústicas
  const weight = wordCount * 1.0 + charCount * 0.12 + shortPauses * 1.5 + longPauses * 3.0;

  return Math.max(1.0, weight);
}

/**
 * Passo D: Distribuição Ponderada por Duração Real do Áudio
 * Calcula com precisão a duração proporcional de cada quadro em relação ao áudio total gerado,
 * garantindo que o tempo de exibição do quadro case com o tempo de leitura do seu trecho de texto (narrationSnippet).
 * Evita atropelos de fala, silêncio fantasma e garante que a soma dos quadros seja rigorosamente igual à duração do áudio.
 */
export function calculateWeightedSceneDurations(
  frames: { id: string; narrationSnippet?: string; label?: string }[],
  totalAudioDuration: number,
  fallbackFullText?: string
): { id: string; duration: number; narrationSnippet?: string }[] {
  if (!frames || frames.length === 0) return [];

  const targetTotal = Number(totalAudioDuration.toFixed(2));

  if (frames.length === 1) {
    const singleSnippet = frames[0].narrationSnippet || fallbackFullText || '';
    return [{ id: frames[0].id, duration: Math.max(1.0, targetTotal), narrationSnippet: singleSnippet }];
  }

  // 1. Calcula os pesos fonéticos individuais com base no narrationSnippet de cada quadro
  const snippets = frames.map((f) => (f.narrationSnippet || '').trim());
  let weights = snippets.map((snip) => estimateTextPhoneticWeight(snip));

  let totalSnippetWeight = weights.reduce((a, b) => a + b, 0);

  // 2. Se os snippets individuais estiverem vazios mas houver fallbackFullText, segmenta as frases do texto
  if (totalSnippetWeight === 0 && fallbackFullText && fallbackFullText.trim()) {
    const fullText = fallbackFullText.trim();
    const sentences = fullText.split(/(?<=[.!?\n])\s+/).filter(Boolean);

    if (sentences.length >= frames.length) {
      const sentencesPerFrame = Math.max(1, Math.floor(sentences.length / frames.length));
      for (let i = 0; i < frames.length; i++) {
        let chunk: string;
        if (i === frames.length - 1) {
          chunk = sentences.slice(i * sentencesPerFrame).join(' ');
        } else {
          chunk = sentences.slice(i * sentencesPerFrame, (i + 1) * sentencesPerFrame).join(' ');
        }
        snippets[i] = chunk;
        weights[i] = estimateTextPhoneticWeight(chunk);
      }
    } else {
      const allWords = fullText.split(/\s+/).filter(Boolean);
      const wordsPerFrame = Math.max(1, Math.floor(allWords.length / frames.length));
      for (let i = 0; i < frames.length; i++) {
        let chunk: string;
        if (i === frames.length - 1) {
          chunk = allWords.slice(i * wordsPerFrame).join(' ');
        } else {
          chunk = allWords.slice(i * wordsPerFrame, (i + 1) * wordsPerFrame).join(' ');
        }
        snippets[i] = chunk;
        weights[i] = estimateTextPhoneticWeight(chunk);
      }
    }
    totalSnippetWeight = weights.reduce((a, b) => a + b, 0);
  }

  // Assegura peso mínimo de 1 para evitar divisão por 0
  const safeWeights = weights.map((w) => (w > 0 ? w : 1.0));
  const finalTotalWeight = safeWeights.reduce((a, b) => a + b, 0);

  // Mínimo de segurança por cena (0.6s ou fração segura)
  const minPerScene = targetTotal >= frames.length * 0.8 ? 0.8 : Math.max(0.4, Number((targetTotal / frames.length).toFixed(2)));

  // 3. Proporção matemática inicial: audio.duration * (Peso_Cena_i / Total_Pesos)
  const durations = safeWeights.map((w) => {
    const rawVal = (targetTotal * w) / finalTotalWeight;
    return Math.max(minPerScene, Number(rawVal.toFixed(2)));
  });

  // 4. Ajusta pequenas discrepâncias de arredondamento em centésimos para que sum(durations) === targetTotal
  let currentSum = Number(durations.reduce((acc, d) => acc + d, 0).toFixed(2));
  let diff = Number((targetTotal - currentSum).toFixed(2));

  let iterations = 0;
  while (Math.abs(diff) >= 0.01 && iterations < 100) {
    iterations++;
    const step = diff > 0 ? 0.01 : -0.01;
    if (diff > 0) {
      let bestIdx = 0;
      for (let i = 1; i < durations.length; i++) {
        if (safeWeights[i] > safeWeights[bestIdx]) {
          bestIdx = i;
        }
      }
      durations[bestIdx] = Number((durations[bestIdx] + step).toFixed(2));
      diff = Number((diff - step).toFixed(2));
    } else {
      let maxIdx = -1;
      let maxVal = -Infinity;
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] > minPerScene + 0.05 && durations[i] > maxVal) {
          maxVal = durations[i];
          maxIdx = i;
        }
      }
      if (maxIdx >= 0) {
        durations[maxIdx] = Number((durations[maxIdx] + step).toFixed(2));
        diff = Number((diff - step).toFixed(2));
      } else {
        break;
      }
    }
  }

  return frames.map((f, idx) => ({
    id: f.id,
    duration: Number(durations[idx].toFixed(2)),
    narrationSnippet: snippets[idx] || f.narrationSnippet,
  }));
}

/**
 * Distribui um texto narrativo completo de forma equilibrada, contínua e sequencial
 * entre os quadros de uma página.
 * Garante que:
 * - O primeiro quadro sempre receba o início do texto.
 * - O último quadro sempre receba o final do texto.
 * - Não haja frases puladas ou repetidas em fallback fora de limites.
 */
export function distributeTextToFrames(fullText: string, frames: FrameItem[]): string[] {
  if (!fullText || !fullText.trim() || !frames || frames.length === 0) {
    return (frames || []).map(() => '');
  }

  const cleanText = fullText.trim();
  const count = frames.length;
  if (count === 1) return [cleanText];

  // 1. Tentar particionar por frases completas (. ! ? …)
  const sentences = cleanText
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length >= count) {
    return frames.map((_, idx) => {
      const start = Math.floor((idx * sentences.length) / count);
      const end = Math.floor(((idx + 1) * sentences.length) / count);
      const slice = sentences.slice(start, Math.max(start + 1, end));
      return slice.join(' ');
    });
  }

  // 2. Se há menos frases que quadros, tentar particionar por orações (vírgulas, ponto-e-vírgula, travessões, quebras de linha)
  const clauses = cleanText
    .split(/(?<=[,;:\-–—\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (clauses.length >= count) {
    return frames.map((_, idx) => {
      const start = Math.floor((idx * clauses.length) / count);
      const end = Math.floor(((idx + 1) * clauses.length) / count);
      const slice = clauses.slice(start, Math.max(start + 1, end));
      return slice.join(' ');
    });
  }

  // 3. Particionar por palavras mantendo a coerência sequencial exata
  const words = cleanText.split(/\s+/).filter(Boolean);
  if (words.length <= count) {
    return frames.map((_, idx) => words[idx] || '');
  }

  return frames.map((_, idx) => {
    const start = Math.floor((idx * words.length) / count);
    const end = Math.floor(((idx + 1) * words.length) / count);
    const slice = words.slice(start, Math.max(start + 1, end));
    return slice.join(' ');
  });
}

/**
 * Associa uma cena retornada pela IA (com quadro_id flexível) ao quadro correspondente.
 * Extrai o número do painel/quadro ignorando indicadores de página "(Pág. X)"
 * para evitar falsos positivos quando o número da página coincide com outros quadros.
 */
export function matchAiSceneToFrame<T extends { quadro_id: string }>(
  frame: FrameItem,
  frameIdx: number,
  cenas: T[],
  usedIndices?: Set<number>
): T | undefined {
  if (!cenas || cenas.length === 0) return undefined;

  const extractPanelNum = (label: string): number | null => {
    if (!label) return null;
    const withoutPage = label.replace(/\(p[aá]g\.?\s*\d+\)/gi, '').trim();
    const qMatch = withoutPage.match(/(?:quadro|painel|cena|frame|zona|box)\s*(\d+)/i);
    if (qMatch) return parseInt(qMatch[1], 10);
    const nMatch = withoutPage.match(/(\d+)/);
    if (nMatch) return parseInt(nMatch[1], 10);
    return null;
  };

  const frameNum = extractPanelNum(frame.label);

  // 1. Tenta correspondência exata por número do quadro (ex: Quadro 01 -> 1)
  if (frameNum !== null) {
    const idx = cenas.findIndex((c, i) => {
      if (usedIndices && usedIndices.has(i)) return false;
      const cNum = extractPanelNum(c.quadro_id);
      return cNum === frameNum;
    });
    if (idx !== -1) {
      if (usedIndices) usedIndices.add(idx);
      return cenas[idx];
    }
  }

  // 2. Tenta correspondência por string normalizada exata (sem startsWith para evitar colisão de "quadro")
  const cleanLabel = frame.label
    .replace(/\(p[aá]g\.?\s*\d+\)/gi, '')
    .replace(/[\[\]]/g, '')
    .trim()
    .toLowerCase();

  const byLabelIdx = cenas.findIndex((c, i) => {
    if (usedIndices && usedIndices.has(i)) return false;
    const cleanQ = c.quadro_id
      .replace(/\(p[aá]g\.?\s*\d+\)/gi, '')
      .replace(/[\[\]]/g, '')
      .trim()
      .toLowerCase();
    return cleanQ === cleanLabel;
  });
  if (byLabelIdx !== -1) {
    if (usedIndices) usedIndices.add(byLabelIdx);
    return cenas[byLabelIdx];
  }

  // 3. Fallback posicional não-utilizado
  if (usedIndices) {
    if (cenas[frameIdx] && !usedIndices.has(frameIdx)) {
      usedIndices.add(frameIdx);
      return cenas[frameIdx];
    }
    const freeIdx = cenas.findIndex((_, i) => !usedIndices.has(i));
    if (freeIdx !== -1) {
      usedIndices.add(freeIdx);
      return cenas[freeIdx];
    }
  }

  return cenas[frameIdx];
}

/**
 * Retorna o trecho de texto específico associado a um determinado quadro.
 * Se o quadro possuir um narrationSnippet explícito (e não for solicitado recálculo forçado), utiliza-o.
 * Caso contrário, segmenta o texto completo da página proporcionalmente garantindo que:
 * - O primeiro quadro sempre receba o início do texto.
 * - Quadros de páginas diferentes nunca recebam índices cumulativos do capítulo inteiro.
 */
export function getFrameNarrationText(
  frame: FrameItem,
  allPageFrames: FrameItem[],
  fullPageText: string,
  options?: { forceRecalculate?: boolean }
): string {
  if (!options?.forceRecalculate && frame.narrationSnippet && frame.narrationSnippet.trim()) {
    return frame.narrationSnippet.trim();
  }
  if (!fullPageText || !fullPageText.trim()) return '';

  const targetFrames =
    frame.pageNumber !== undefined && allPageFrames.some((f) => f.pageNumber !== frame.pageNumber)
      ? allPageFrames.filter((f) => f.pageNumber === frame.pageNumber)
      : allPageFrames;

  const sortedFrames = [...targetFrames].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
  );

  const frameIdx = sortedFrames.findIndex((f) => f.id === frame.id);
  if (frameIdx < 0) return fullPageText.trim();

  const distributed = distributeTextToFrames(fullPageText, sortedFrames);
  return distributed[frameIdx] || fullPageText.trim();
}

/**
 * Alinha e sincroniza rigorosamente a duração de todos os quadros com os áudios gerados,
 * distribuindo o tempo de cada quadro proporcionalmente ao peso fonético de seu trecho de texto (narrationSnippet).
 * Garante que:
 * 1. Cada quadro fique na tela exatamente o tempo necessário para que seu texto seja narrado.
 * 2. A soma dos tempos dos quadros de cada página/cena seja exatamente igual à duração do áudio daquela página.
 * 3. O áudio do próximo capítulo/página entre sem nenhum atraso acumulado ou silêncio.
 */
export function realignAllFramesWithAudio(
  frames: FrameItem[],
  scenes: SceneItem[]
): { id: string; duration: number; narrationSnippet?: string }[] {
  if (!frames || frames.length === 0) return [];

  const updates: { id: string; duration: number; narrationSnippet?: string }[] = [];

  // Agrupa os quadros por chave (chapterId + pageNumber)
  const pageMap = new Map<string, FrameItem[]>();
  frames.forEach((f) => {
    const key = `${f.chapterId || ''}_p${f.pageNumber ?? 1}`;
    if (!pageMap.has(key)) {
      pageMap.set(key, []);
    }
    pageMap.get(key)!.push(f);
  });

  // Para cada grupo de quadros da página:
  pageMap.forEach((pageFrames) => {
    const sample = pageFrames[0];
    const matchedScene = scenes.find(
      (s) =>
        (s.chapterId && sample.chapterId && s.pageNumber && sample.pageNumber &&
          s.chapterId === sample.chapterId && Number(s.pageNumber) === Number(sample.pageNumber)) ||
        s.frames?.some((sf) => pageFrames.some((pf) => pf.id === sf.id)) ||
        (s.pageNumber && sample.pageNumber && Number(s.pageNumber) === Number(sample.pageNumber))
    );

    const fullText = matchedScene?.text?.trim() || '';
    const audioDur = matchedScene?.audioDuration;

    // Se temos áudio gerado com duração válida:
    if (audioDur && audioDur > 0) {
      const framesWithText = pageFrames.map((f) => ({
        id: f.id,
        narrationSnippet: getFrameNarrationText(f, pageFrames, fullText),
        label: f.label,
      }));

      const weighted = calculateWeightedSceneDurations(framesWithText, audioDur, fullText);
      updates.push(...weighted);
    } else if (fullText) {
      // Se não há áudio gerado mas há texto, calcula a duração estimada com base na fala natural (~135 palavras/min)
      const totalWords = fullText.split(/\s+/).filter(Boolean).length;
      const estimatedAudioDur = Math.max(pageFrames.length * 1.5, (totalWords / 135) * 60);

      const framesWithText = pageFrames.map((f) => ({
        id: f.id,
        narrationSnippet: getFrameNarrationText(f, pageFrames, fullText),
        label: f.label,
      }));

      const weighted = calculateWeightedSceneDurations(framesWithText, estimatedAudioDur, fullText);
      updates.push(...weighted);
    }
  });

  return updates;
}

export interface GenerateSpeechOptions {
  text: string;
  model?: string;
  config?: AiNarrationConfig;
}

export interface GeneratedSpeechResult {
  blob: Blob;
  audioUrl: string;
  duration: number;
}

/**
 * Passo B: Chamada ao endpoint /v1/audio/speech do 9router
 * Gera um arquivo binário MP3 consolidado e retorna o Blob, URL e a duração exata medida.
 */
export async function generate9routerSpeech(
  options: GenerateSpeechOptions
): Promise<GeneratedSpeechResult> {
  const config = options.config || loadAiNarrationConfig();
  const text = (options.text || '').trim();

  if (!text) {
    throw new Error('Nenhum texto de narração para gerar áudio.');
  }

  let base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const ttsUrl = base.endsWith('/v1') ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
  const model =
    options.model || config.ttsModel || DEFAULT_AI_CONFIG.ttsModel;
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();

  const payload = {
    model,
    input: text,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }
    throw new Error(
      `Erro no TTS do 9router (HTTP ${response.status}): ${errorDetail || response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  const audioUrl = URL.createObjectURL(blob);

  // Extrai a duração real do áudio gerado
  const duration = await getAudioBlobDuration(blob);

  return {
    blob,
    audioUrl,
    duration,
  };
}

/**
 * Prepares and compresses a raw page image URL to a clean Base64 data URL
 */
export async function prepareImageForAi(
  imageUrl: string,
  maxWidth = 1200,
  maxHeight = 2000
): Promise<string> {
  if (imageUrl.startsWith('data:image/') && imageUrl.length < 1_200_000) {
    return imageUrl;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Falha ao instanciar canvas 2D');
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('Não foi possível carregar a imagem da página para leitura pela IA.'));
    };

    img.src = imageUrl;
  });
}

export interface TestAiConnectionResult {
  success: boolean;
  message: string;
  models?: string[];
}

/**
 * Busca a lista de modelos disponíveis no endpoint compatível com OpenAI (/models)
 */
export async function fetchAvailableModels(config: AiNarrationConfig): Promise<string[]> {
  const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json().catch(() => null);
  const modelList: string[] = [];
  if (Array.isArray(data?.data)) {
    for (const item of data.data) {
      if (item?.id && typeof item.id === 'string') {
        modelList.push(item.id);
      }
    }
  }
  return modelList;
}

/**
 * Tests connection to the 9router / OpenAI-compatible endpoint
 */
export async function testAiConnection(config: AiNarrationConfig): Promise<TestAiConnectionResult> {
  const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const modelList: string[] = [];
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (item?.id && typeof item.id === 'string') {
            modelList.push(item.id);
          }
        }
      }
      return {
        success: true,
        message: `Conexão bem-sucedida! (${modelList.length > 0 ? `${modelList.length} modelos detectados` : 'Online'})`,
        models: modelList,
      };
    } else {
      return {
        success: false,
        message: `Servidor retornou status HTTP ${res.status}: ${res.statusText}`,
      };
    }
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return {
        success: false,
        message:
          `Não foi possível conectar em ${base}. Verifique se o servidor de IA ou 9router está ativo.`,
      };
    }
    return {
      success: false,
      message: `Erro de conexão: ${msg}`,
    };
  }
}

/**
 * Extracts and decodes text from either Server-Sent Events (SSE) stream or standard JSON
 */
export function decodeSseOrJson(rawText: string): string {
  const trimmed = rawText.trim();

  // If response has SSE data lines
  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    let accumulated = '';
    const lines = trimmed.split('\n');
    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine || cleanLine.startsWith(':')) continue;
      if (cleanLine === 'data: [DONE]') continue;
      if (cleanLine.startsWith('data:')) {
        const jsonStr = cleanLine.slice(5).trim();
        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string') {
            accumulated += delta;
          } else {
            const msg = chunk?.choices?.[0]?.message?.content;
            if (typeof msg === 'string') {
              accumulated += msg;
            }
          }
        } catch {
          // ignore partial json chunk
        }
      }
    }
    if (accumulated.trim()) return accumulated.trim();
  }

  // Standard JSON response
  try {
    const data = JSON.parse(trimmed);
    const text =
      data?.choices?.[0]?.message?.content ||
      data?.choices?.[0]?.delta?.content ||
      '';
    if (typeof text === 'string' && text.trim()) return text.trim();
  } catch {}

  return trimmed;
}

/**
 * Trunca suavemente o texto da narração se exceder a contagem máxima de palavras
 * para garantir que o tempo de fala NUNCA ultrapasse o teto de 10 segundos.
 */
export function clampFrameWords(text: string, maxWords: number = 24): string {
  if (!text) return '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();

  const slice = words.slice(0, maxWords).join(' ');
  const lastPunct = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?'),
    slice.lastIndexOf('…')
  );

  if (lastPunct > slice.length * 0.6) {
    return slice.slice(0, lastPunct + 1).trim();
  }

  return `${slice}...`;
}

/**
 * Builds the exact Backend System Prompt for Chapter-wide Recap Generation (Atomic per-scene granularity)
 */
export function buildChapterNarrationSystemPrompt(
  profileId: string = 'sarcastico',
  customTonePrompt?: string,
  projectMetadata?: ProjectMetadata,
  chapterMetadata?: ChapterMetadata
): string {
  const profile = NARRATION_PROFILES.find((p) => p.id === profileId) || NARRATION_PROFILES[0];
  const activeTone = customTonePrompt?.trim() || profile.systemDescription;

  let charactersBlock = '';
  if (projectMetadata?.characters && projectMetadata.characters.length > 0) {
    const list = projectMetadata.characters.map((c) => {
      const aliases = c.aliases?.length ? ` (alcunhas: ${c.aliases.join(', ')})` : '';
      const desc = c.description ? ` - ${c.description}` : '';
      return `• ${c.name} [Papel: ${c.role}]${aliases}${desc}`;
    });
    charactersBlock = `\nPERSONAGENS IDENTIFICADOS DA OBRA:\n${list.join('\n')}\nUtilize sempre os nomes reais dos personagens acima ao invés de termos genéricos como "o rapaz" ou "o guerreiro".\n`;
  }

  let glossaryBlock = '';
  if (projectMetadata?.glossary && Object.keys(projectMetadata.glossary).length > 0) {
    const terms = Object.entries(projectMetadata.glossary)
      .map(([term, desc]) => `• ${term}: ${desc}`)
      .join('\n');
    glossaryBlock = `\nGLOSSÁRIO E SISTEMA DE PODER DA OBRA:\n${terms}\n`;
  }

  const workTitleBlock = projectMetadata?.workTitle ? ` da obra "${projectMetadata.workTitle}"` : '';
  const synopsisBlock = chapterMetadata?.synopsis
    ? `\nCONTEXTO DO ARCO/CAPÍTULO ATUAL: ${chapterMetadata.synopsis}\n`
    : '';

  let macroBlock = '';
  if (chapterMetadata?.macroContext) {
    const { synopsis, characterDynamics, criticalRules } = chapterMetadata.macroContext;
    const rulesList = (criticalRules || []).map((r) => `  • ${r}`).join('\n');
    macroBlock = `
╔═══════════════════════════════════════════════════════════════════════════════════════╗
║ BÍBLIA FÁTICA DO CAPÍTULO (VERDADES INEGOCIÁVEIS DA HISTÓRIA - SIGA RIGOROSAMENTE)    ║
╠═══════════════════════════════════════════════════════════════════════════════════════╣
║ 1. ENREDO DO CAPÍTULO:                                                                ║
║    ${synopsis || chapterMetadata?.synopsis || 'Conforme a narrativa visual.'}
║                                                                                       ║
║ 2. VERDADEIRA NATUREZA E FORÇA DOS PERSONAGENS / ESQUADRÃO:                           ║
║    ${characterDynamics || 'Veteranos experientes/conforme contexto fático.'}
║                                                                                       ║
║ 3. REGRAS OBRIGATÓRIAS ANTI-ALUCINAÇÃO (NUNCA PRESUMA O CONTRÁRIO):                   ║
${rulesList || '  • Mantenha fidelidade absoluta aos papéis e à força real dos personagens.'}
╚═══════════════════════════════════════════════════════════════════════════════════════╝
`;
  }

  return `Você é um Roteirista Profissional de Canais de Recap de Manhwa no YouTube (especialista em retenção e storytelling falado)${workTitleBlock}.

OBJETIVO:
Criar uma narrativa contínua, ágil e envolvente para acompanhar a sequência de quadros recortados. 

PERFIL ATIVO DO NARRADOR: ${profile.name}
${activeTone}

${workTitleBlock ? `OBRA: ${projectMetadata?.workTitle}` : ''}
${macroBlock || synopsisBlock}${charactersBlock}${glossaryBlock}
ANCORAGEM VISUAL OBRIGATÓRIA (PIPELINE SET-OF-MARK / SoM):
1. MOLDURAS DEMARCADAS NA IMAGEM:
   - As páginas contêm anotações visuais no padrão Set-of-Mark (SoM): molduras retangulares coloridas de alto contraste com etiquetas visíveis (ex: "[Quadro 01]", "[Quadro 02]", etc.) desenhadas diretamente sobre os painéis da página.
   - O que vai ao ar no vídeo final são EXCLUSIVAMENTE os recortes destacados dentro dessas caixas demarcadas!
   - A página inteira serve para você entender o contexto narrativo macro (o que aconteceu antes e depois).
   - O "roteiro_cena" de cada item DEVE ser ESTRITAMENTE ancorado no que acontece dentro da moldura demarcada correspondente ("[Quadro 01]", "[Quadro 02]", etc.).

2. NUNCA FAÇA AUDIODESCRIÇÃO MECÂNICA:
   - É terminantemente PROIBIDO narrar ações literais e mecânicas como: "Documentos são jogados", "O homem agarra um cinzeiro", "O sangue escorre pela parede", "Ele olha cabisbaixo". O espectador JÁ ESTÁ VENDO a imagem!
   - Conte a HISTÓRIA, o contexto, a revolta, a sensação do momento e as intenções secretas.
   - Ruim (Proibido): "O chefe joga papéis na mesa. O homem agarra um cinzeiro. O golpe atinge a cabeça."
   - Bom (Obrigatório): "Aquele chefe desgraçado humilhava Chen todo dia... calado, engolindo seco. Mas dessa vez a covardia passou dos limites... do nada, o desgraçado pegou um cinzeiro pesado... e acertou em cheio na cabeça dele!"

3. FLUXO CONTÍNUO (SEM FRASES PICOTADAS):
   - As falas dos quadros NÃO podem parecer ilhas isoladas terminando secamente em ponto final.
   - Conecte o final de uma frase com o início da próxima usando conjunções e ganchos ("E mesmo assim...", "Mas ele não esperava que...", "Só que dessa vez...", "Enquanto isso...", "Até que...", "E o pior é que...", "Do nada...").
   - Quando lidas em sequência, as falas de todos os quadros DEVEM soar como um único parágrafo fluido, contado por alguém empolgado em um microfone de YouTube.

4. COLOQUIALISMO E ENERGIA DE RECAP (YOUTUBE):
   - Use linguagem falada natural do YouTube, com atitude, gírias leves e cumplicidade com o protagonista.
   - NUNCA transcreva balões de fala palavra por palavra. Resuma as intenções com a voz do narrador.

5. RITMO E CONTAGEM ESTRITA DE PALAVRAS (LIMITE OBRIGATÓRIO DE 5.0s A 10.0s POR CENA):
   - CONTAGEM DE PALAVRAS OBRIGATÓRIA: Cada quadro recortado ("roteiro_cena") DEVE conter ESTRITAMENTE entre 12 e 22 palavras faladas (máximo absoluto de 24 palavras).
   - É TERMINANTEMENTE PROIBIDO ultrapassar 25 palavras por quadro sob hipótese alguma.
   - Em velocidade natural de fala (2.5 palavras por segundo), 12 a 22 palavras cravam a duração com precisão entre 5.0 e 9.0 segundos.
   - Duração por cena ("duracao_segundos"): OBRIGATORIAMENTE entre 5.0 e 9.5 segundos (JAMAIS ultrapasse 10.0 segundos).
   - Fidelidade Temporal Rigorosa: A narração deve descrever com clareza e ritmo natural EXATAMENTE a ação e emoção do quadro ATUAL, sem antecipar o quadro posterior e sem arrastar resquícios do quadro anterior.

6. TRANSIÇÕES PERMITIDAS:
   - Escolha para cada cena: "zoom_in", "zoom_out", "pan_down", "pan_up", "fade", "corte_seco". Varie sem repetir consecutivamente.

7. PROIBIDO JULGAR PELA APARÊNCIA OU INVENTAR FRAQUEZA (ANTI-ALUCINAÇÃO):
   - NUNCA presuma que personagens, aliados ou esquadrões são "novatos", "fracos", "preguiçosos" ou "covardes" apenas por estarem sentados, rindo, descontraídos ou em poses casuais.
   - Em webtoons/manhwas militares e de fantasia, guerreiros veteranos e insanos frequentemente agem com desdém ou humor negro diante da morte. Trate essa postura como frieza calejada e experiência brutal, NUNCA como desleixo amador.
   - Respeite ESTRITAMENTE a BÍBLIA FÁTICA DO CAPÍTULO acima.

8. REGRA ABSOLUTA DE NÃO-REPETIÇÃO POR QUADRO:
   - Cada quadro recortado da página DEVE conter uma fala narrada 100% ÚNICA e progressiva.
   - É TERMINANTEMENTE PROIBIDO repetir a mesma frase, fala ou diálogo em mais de um quadro da mesma página.
   - Se a página contém 4 quadros demarcados, você DEVE retornar 4 cenas com textos narrativos diferentes que avançam a história sequencialmente.

FORMATO DE RESPOSTA OBRIGATÓRIO (JSON):
{
  "resumo_capitulo": "Visão geral do capítulo em 2 frases.",
  "paginas": [
    {
      "pagina_numero": 1,
      "cenas": [
        {
          "quadro_id": "Quadro 01",
          "roteiro_cena": "Chen já não aguentava mais ser pisoteado por aquele chefe arrogante, engolindo humilhações diárias em silêncio absoluto...",
          "duracao_segundos": 6.8,
          "transicao": "zoom_in"
        },
        {
          "quadro_id": "Quadro 02",
          "roteiro_cena": "mas daquela vez o covarde passou de todos os limites imagináveis, arremessando um cinzeiro pesado direto contra a cabeça do rapaz!",
          "duracao_segundos": 7.4,
          "transicao": "pan_down"
        }
      ]
    }
  ]
}`;
}

export interface AiSceneResultItem {
  quadro_id: string;
  roteiro_cena: string;
  duracao_segundos: number;
  transicao: TransitionType;
}

export interface ChapterPageItem {
  pageNumber: number;
  rawImageUrl: string;
  croppedFramesCount: number;
  croppedFramesLabels?: string[];
  frames?: FrameItem[];
}

export interface ChapterNarrationResult {
  resumo_capitulo: string;
  paginas: {
    pagina_numero: number;
    cenas: AiSceneResultItem[];
    roteiro: string;
  }[];
  macroContext?: ChapterMacroContext;
  suggestedWorkTitle?: string;
  detectedCharacters?: CharacterMetadata[];
}

export interface PageNarrationResult {
  fullScript: string;
  cenas: AiSceneResultItem[];
}

/**
 * Macro Vision Generation: Sends all pages of the chapter in ONE call to analyze the full dramatic arc,
 * returning structured atomic per-scene narration distributed by page in JSON.
 * Incorporates Set-of-Mark (SoM) bounding box visual annotations directly onto page images.
 */
export async function generateChapterNarrationWithVision(params: {
  chapterLabel: string;
  pages: ChapterPageItem[];
  profileId: string;
  config?: AiNarrationConfig;
  onProgress?: (info: { stage: string; current?: number; total?: number }) => void;
}): Promise<ChapterNarrationResult> {
  const config = params.config || loadAiNarrationConfig();
  const profile = NARRATION_PROFILES.find((p) => p.id === params.profileId) || NARRATION_PROFILES[0];
  const systemPrompt = buildChapterNarrationSystemPrompt(profile.id);

  if (params.pages.length === 0) {
    throw new Error('Nenhuma página para gerar narração.');
  }

  // 1. Prepare and annotate all page images with Set-of-Mark (SoM) boxes & badges
  params.onProgress?.({
    stage: 'Carregando e gerando anotações Set-of-Mark (SoM) no capítulo...',
    current: 0,
    total: params.pages.length,
  });

  const base64Images: string[] = [];
  for (let i = 0; i < params.pages.length; i++) {
    const page = params.pages[i];
    params.onProgress?.({
      stage: `Anotando Set-of-Mark na página ${page.pageNumber} (${i + 1}/${params.pages.length})...`,
      current: i + 1,
      total: params.pages.length,
    });

    let b64: string;
    if (page.frames && page.frames.length > 0) {
      b64 = await generateSoMAnnotatedPage({
        rawImageUrl: page.rawImageUrl,
        frames: page.frames,
        maxWidth: 1200,
        maxHeight: 1800,
      });
    } else {
      b64 = await prepareImageForAi(page.rawImageUrl, 1100, 1800);
    }
    base64Images.push(b64);
  }

  // 2. Build single macro multimodal prompt with per-scene instructions
  params.onProgress?.({
    stage: `Analisando cenas atômicas com Set-of-Mark via IA (${profile.name})...`,
  });

  const userContent: any[] = [
    {
      type: 'text',
      text: `Capítulo completo para narração atômica: "${params.chapterLabel}".
Total de páginas com recortes neste capítulo: ${params.pages.length}.
Perfil selecionado da narração: ${profile.name} (${profile.description}).

INSTRUÇÃO SET-OF-MARK (SoM):
As imagens fornecidas contêm molduras retangulares coloridas de alto contraste com etiquetas visíveis (ex: "[Quadro 01]", "[Quadro 02]", etc.) demarcando exatamente as áreas que foram recortadas pelo editor.
Analise os acontecimentos da página e crie uma narrativa contínua e envolvente para acompanhar os recortes, ancorando o texto de cada cena estritamente no que acontece dentro da moldura colorida correspondente.

REGRAS DE RETENÇÃO E STORYTELLING (PROIBIDO AUDIODESCRIÇÃO):
1. ANCORAGEM VISUAL:
   - Apenas o que está dentro das molduras demarcadas irá ao ar no vídeo final. A página inteira serve para contextualização dramática macro.
   - O "roteiro_cena" deve ser focado na ação e emoção dentro da moldura demarcada.
2. PROIBIDO AUDIODESCRIÇÃO MECÂNICA:
   - NUNCA descreva o que o espectador já está vendo (NUNCA diga "Ele olha surpreso", "Documentos são jogados", "O sangue escorre", "O homem pega um cinzeiro").
   - Foque no contexto, nas intenções, na revolta e na tensão dramática.
3. FLUXO CONTÍNUO (SEM FRASES PICOTADAS):
   - As falas não podem parecer ilhas soltas. Use conectivos ("E mesmo assim...", "Só que dessa vez...", "Enquanto isso...", "Do nada...").
   - Lidas juntas, as falas de todos os quadros devem soar como uma história única e fluida para o YouTube.
4. RITMO E EXTENSÃO CALIBRADA (5.0s A 10.0s POR CENA):
   - Duração por cena ("duracao_segundos"): OBRIGATORIAMENTE entre 5.0 e 10.0 segundos, ajustada conforme a intensidade dramática da cena.
   - Cada quadro ("roteiro_cena"): conter entre 12 e 25 palavras, proporcionando tempo suficiente para o narrador contextualizar, transmitir o impacto e criar ganchos naturais sem pressa.
   - Fidelidade Temporal Rigorosa: A narração deve descrever estritamente o acontecimento do quadro ATUAL, sem antecipar o próximo e sem arrastar resquícios do anterior.
5. Transições permitidas: "zoom_in", "zoom_out", "pan_down", "fade", "corte_seco". Varie as transições sem repetir consecutivamente.
Retorne OBRIGATORIAMENTE no formato JSON especificado com "resumo_capitulo" e o array "paginas", contendo cada "pagina_numero" e seu array de "cenas" com "quadro_id", "roteiro_cena", "duracao_segundos" e "transicao".`,
    },
  ];

  for (let i = 0; i < params.pages.length; i++) {
    const page = params.pages[i];
    const b64 = base64Images[i];
    const labelsList =
      page.croppedFramesLabels && page.croppedFramesLabels.length > 0
        ? page.croppedFramesLabels.join(', ')
        : 'Quadro 01';

    userContent.push({
      type: 'text',
      text: `=== PÁGINA ${page.pageNumber} (Set-of-Mark com ${page.croppedFramesCount} cena(s) demarcada(s): ${labelsList}) ===
Esta imagem contém molduras coloridas de alto contraste com tags [${labelsList}].
Gere no array "cenas" desta página exatamente as cenas correspondentes a cada moldura demarcada: ${labelsList}.`,
    });
    userContent.push({
      type: 'image_url',
      image_url: {
        url: b64,
      },
    });
  }

  const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const payload = {
    model: config.model || DEFAULT_AI_CONFIG.model,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    temperature: config.temperature ?? 0.72,
    max_tokens: 4500,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream, */*',
  };
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }
    throw new Error(
      `Erro da API 9router (HTTP ${response.status}): ${errorDetail || response.statusText}`
    );
  }

  const rawText = await response.text();
  const decodedText = decodeSseOrJson(rawText);

  // Extract JSON
  let cleanJson = decodedText.trim();
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  // Find braces if wrapped in preamble
  const firstBrace = cleanJson.indexOf('{');
  const lastBrace = cleanJson.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
  }

  let result: ChapterNarrationResult;
  try {
    const parsed = JSON.parse(cleanJson);
    if (!parsed || !Array.isArray(parsed.paginas)) {
      throw new Error('JSON retornado não contém o array "paginas".');
    }

    const paginas = parsed.paginas.map((p: any) => {
      const pageNum = Number(p.pagina_numero || p.pagina || p.page || 0);
      let rawCenas = Array.isArray(p.cenas) ? p.cenas : [];

      if (rawCenas.length === 0 && p.roteiro) {
        rawCenas = [
          {
            quadro_id: 'Quadro 01',
            roteiro_cena: String(p.roteiro).trim(),
            duracao_segundos: 6.0,
            transicao: 'zoom_in',
          },
        ];
      }

      const cenas: AiSceneResultItem[] = rawCenas.map((c: any, cIdx: number) => {
        const rawDur = parseFloat(c.duracao_segundos || c.duracao || c.duration || 6.0);
        const script = String(c.roteiro_cena || c.roteiro || c.text || '').trim();
        const speechMin = calculateRequiredSpeechDuration(script);
        // Ensure duration accommodates speech while respecting calibrated limits (5.0s to 10.0s)
        const calculated = !isNaN(rawDur) && rawDur >= 5.0 && rawDur <= 10.0
          ? Math.max(rawDur, speechMin)
          : Math.max(5.0, Math.min(10.0, speechMin));
        const dur = Math.min(10.0, Math.max(5.0, Math.round(calculated * 10) / 10));
        return {
          quadro_id: String(c.quadro_id || c.label || `Quadro ${String(cIdx + 1).padStart(2, '0')}`).trim(),
          roteiro_cena: script,
          duracao_segundos: dur,
          transicao: normalizeTransitionType(c.transicao || c.transition, cIdx),
        };
      });

      const combinedRoteiro = cenas
        .map((c) => c.roteiro_cena)
        .filter(Boolean)
        .join(' ');

      return {
        pagina_numero: pageNum,
        cenas,
        roteiro: combinedRoteiro || String(p.roteiro || '').trim(),
      };
    });

    result = {
      resumo_capitulo: parsed.resumo_capitulo || '',
      paginas,
    };
  } catch (err: any) {
    throw new Error(`Falha ao decodificar JSON da narração: ${err?.message || err}. Texto recebido: ${decodedText.slice(0, 200)}...`);
  }

  return result;
}

/**
 * Single page generation using the chosen profile
 */
export async function generatePageNarrationWithVision(params: {
  rawImageUrl: string;
  chapterLabel: string;
  pageNumber: number;
  totalPages: number;
  croppedFramesCount: number;
  croppedFramesLabels?: string[];
  frames?: FrameItem[];
  previousPageNarration?: string;
  config?: AiNarrationConfig;
  stylePresetId?: string;
  customSystemPrompt?: string;
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: ChapterMetadata;
}): Promise<PageNarrationResult> {
  const config = params.config || loadAiNarrationConfig();
  const profileId = params.stylePresetId || config.stylePreset || 'sarcastico';
  const profile = NARRATION_PROFILES.find((p) => p.id === profileId) || NARRATION_PROFILES[0];
  const systemPrompt = buildChapterNarrationSystemPrompt(
    profile.id,
    params.customSystemPrompt,
    params.projectMetadata,
    params.chapterMetadata
  );

  let base64Image = '';
  try {
    if (params.frames && params.frames.length > 0) {
      base64Image = await generateSoMAnnotatedPage({
        rawImageUrl: params.rawImageUrl,
        frames: params.frames,
        maxWidth: 1050,
        maxHeight: 1800,
        quality: 0.76,
      });
    } else {
      base64Image = await prepareImageForAi(params.rawImageUrl, 1050, 1800);
    }
  } catch (err: any) {
    throw new Error(`Falha ao processar a imagem da página para a IA: ${err?.message || err}`);
  }

  const framesList =
    params.croppedFramesLabels && params.croppedFramesLabels.length > 0
      ? params.croppedFramesLabels
      : ['Quadro 01'];

  const prevContextText = params.previousPageNarration
    ? `\nContexto da página anterior (para manter transição imperceptível):\n"${params.previousPageNarration.slice(-250)}"\n`
    : '';

  const userPromptText = `Capítulo: ${params.chapterLabel}
Página: ${params.pageNumber} de ${params.totalPages}
Quantidade de cenas recortadas nesta página: ${Math.max(1, params.croppedFramesCount)} cena(s): ${framesList.join(', ')}.
A imagem desta página contém anotações visuais no padrão Set-of-Mark (SoM): molduras retangulares coloridas de alto contraste com etiquetas [${framesList.join(', ')}] demarcando exatamente as áreas dos recortes do editor.
${prevContextText}
Sob a ótica do perfil "${profile.name}" (${profile.description}), analise os acontecimentos internos de cada moldura demarcada e crie uma narrativa contínua e envolvente para acompanhar os recortes desta página.

REGRAS DE ANCORAGEM VISUAL E RETENÇÃO (SoM):
1. ANCORAGEM NAS MOLDURAS:
   - Apenas o que está dentro das molduras demarcadas irá ao ar no vídeo final. A página inteira serve para contextualização dramática macro.
   - O "roteiro_cena" deve ser estritamente focado na ação, emoção e drama contidos dentro de cada moldura colorida correspondente (${framesList.join(', ')}).
2. PROIBIDO AUDIODESCRIÇÃO MECÂNICA:
   - NUNCA descreva o que o espectador já está vendo (NUNCA diga "Ele olha surpreso", "Documentos são jogados", "O sangue escorre").
   - Foque no contexto, nas intenções, na revolta e na tensão dramática.
3. FLUXO CONTÍNUO (SEM FRASES PICOTADAS):
   - As falas não podem parecer ilhas soltas. Use conectivos ("E mesmo assim...", "Só que dessa vez...", "Enquanto isso...", "Do nada...").
   - Lidas juntas, as falas de todos os quadros desta página DEVEM soar como uma história única e fluida para o YouTube.
4. RITMO E CONTAGEM ESTRITA DE PALAVRAS (LIMITE DE 5.0s A 10.0s POR CENA):
   - CONTAGEM DE PALAVRAS OBRIGATÓRIA: Cada quadro recortado ("roteiro_cena") DEVE conter ESTRITAMENTE entre 12 e 22 palavras faladas (máximo absoluto de 24 palavras).
   - É TERMINANTEMENTE PROIBIDO ultrapassar 25 palavras por quadro sob hipótese alguma.
   - Em ritmo de fala de 2.5 palavras/segundo, 12 a 22 palavras cravam a duração entre 5.0s e 9.0s.
   - Duração por cena ("duracao_segundos"): OBRIGATORIAMENTE entre 5.0 e 9.5 segundos.
   - Fidelidade Temporal Rigorosa: A narração deve descrever estritamente o acontecimento do quadro ATUAL, sem antecipar o próximo e sem arrastar resquícios do anterior.
5. Transições permitidas: "zoom_in", "zoom_out", "pan_down", "fade", "corte_seco". Evite repetir a mesma transição consecutivamente.

Retorne no formato JSON:
{
  "paginas": [
    {
      "pagina_numero": ${params.pageNumber},
      "cenas": [
        ${framesList
          .map(
            (lbl, idx) => `{
          "quadro_id": "${lbl}",
          "roteiro_cena": "Frase de 12 a 22 palavras com storytelling vívido e conectivos naturais para este momento...",
          "duracao_segundos": 6.8,
          "transicao": "${idx % 2 === 0 ? 'zoom_in' : 'zoom_out'}"
        }`
          )
          .join(',\n        ')}
      ]
    }
  ]
}`;

  const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const payload = {
    model: config.model || DEFAULT_AI_CONFIG.model,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userPromptText,
          },
          {
            type: 'image_url',
            image_url: {
              url: base64Image,
            },
          },
        ],
      },
    ],
    temperature: config.temperature ?? 0.72,
    max_tokens: 2000,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream, */*',
  };
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await response.text().catch(() => '');
    }
    throw new Error(
      `Erro da API 9router (HTTP ${response.status}): ${errorDetail || response.statusText}`
    );
  }

  const rawText = await response.text();
  const decoded = decodeSseOrJson(rawText);

  let clean = decoded.trim();
  if (clean.startsWith('```')) {
    clean = clean.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }

  try {
    const firstBrace = clean.indexOf('{');
    const lastBrace = clean.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      const jsonStr = clean.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed?.paginas) && parsed.paginas[0]) {
        const p = parsed.paginas[0];
        let rawCenas = Array.isArray(p.cenas) ? p.cenas : [];
        if (rawCenas.length === 0 && p.roteiro) {
          rawCenas = [
            {
              quadro_id: 'Quadro 01',
              roteiro_cena: String(p.roteiro).trim(),
              duracao_segundos: 6.5,
              transicao: 'zoom_in',
            },
          ];
        }

        const cenas: AiSceneResultItem[] = rawCenas.map((c: any, cIdx: number) => {
          const rawDur = parseFloat(c.duracao_segundos || c.duracao || c.duration || 6.5);
          const rawScript = String(c.roteiro_cena || c.roteiro || c.text || '').trim();
          const script = clampFrameWords(rawScript, 24);
          const speechMin = calculateRequiredSpeechDuration(script);
          const calculated = !isNaN(rawDur) && rawDur >= 5.0 && rawDur <= 9.5
            ? Math.max(rawDur, speechMin)
            : Math.max(5.0, Math.min(9.5, speechMin));
          const dur = Math.min(9.5, Math.max(5.0, Math.round(calculated * 10) / 10));
          return {
            quadro_id: String(c.quadro_id || c.label || `Quadro ${String(cIdx + 1).padStart(2, '0')}`).trim(),
            roteiro_cena: script,
            duracao_segundos: dur,
            transicao: normalizeTransitionType(c.transicao || c.transition, cIdx),
          };
        });

        const fullScript =
          cenas
            .map((c) => c.roteiro_cena)
            .filter(Boolean)
            .join(' ') || String(p.roteiro || '').trim();

        return { fullScript, cenas };
      }
    }
  } catch {}

  return { fullScript: clean, cenas: [] };
}

export interface AnalyzeMacroContextParams {
  chapterLabel: string;
  pages: ChapterPageItem[];
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: ChapterMetadata;
  config?: AiNarrationConfig;
  onProgress?: (info: { stage: string; current?: number; total?: number }) => void;
}

export interface ChapterMacroContextResult {
  synopsis: string;
  characterDynamics: string;
  criticalRules: string[];
  suggestedWorkTitle?: string;
  detectedCharacters?: CharacterMetadata[];
}

/**
 * Fase Macro (Scanner Global do Capítulo):
 * Analisa uma amostragem estratégica de páginas do capítulo para extrair a
 * "Bíblia Fática do Capítulo". Evita que blocos isolados alucinem que personagens
 * calejados/insanos são "novatos preguiçosos".
 */
export async function analyzeChapterMacroContext(
  params: AnalyzeMacroContextParams
): Promise<ChapterMacroContextResult> {
  const config = params.config || loadAiNarrationConfig();
  const validPages = params.pages.filter((p) => p.rawImageUrl);
  if (validPages.length === 0) {
    throw new Error('Nenhuma página com imagem disponível para análise macro do capítulo.');
  }

  params.onProgress?.({
    stage: 'Selecionando e otimizando amostras visuais do capítulo...',
    current: 1,
    total: 3,
  });

  // Seleciona de 4 a 6 páginas distribuídas ao longo do capítulo (início, meio, ápice e fim)
  const totalP = validPages.length;
  let sampleIndices: number[] = [];
  if (totalP <= 5) {
    sampleIndices = validPages.map((_, i) => i);
  } else {
    sampleIndices = [
      0,
      1,
      Math.floor(totalP * 0.35),
      Math.floor(totalP * 0.65),
      totalP - 1,
    ];
    sampleIndices = Array.from(new Set(sampleIndices)).sort((a, b) => a - b);
  }

  const sampledPages = sampleIndices.map((i) => validPages[i]);

  // Gera thumbnails leves em paralelo (maxWidth 720, maxHeight 1150, qualidade 0.68 para envio ultrarrápido)
  const preparedImages = await Promise.all(
    sampledPages.map(async (page) => {
      try {
        const b64 = await prepareImageForAi(page.rawImageUrl, 720, 1150);
        return { pageNumber: page.pageNumber, b64 };
      } catch (err) {
        console.warn(`Aviso ao otimizar página ${page.pageNumber} para macro scan:`, err);
        return null;
      }
    })
  );

  const validSampled = preparedImages.filter((p): p is { pageNumber: number; b64: string } => p !== null);
  if (validSampled.length === 0) {
    throw new Error('Falha ao processar imagens para a análise macro do capítulo.');
  }

  params.onProgress?.({
    stage: 'Analisando arco do capítulo e verdade dos personagens com IA...',
    current: 2,
    total: 3,
  });

  let knownCharactersPrompt = '';
  if (params.projectMetadata?.characters && params.projectMetadata.characters.length > 0) {
    const list = params.projectMetadata.characters
      .map((c) => `• ${c.name} (${c.role}): ${c.description || ''}`)
      .join('\n');
    knownCharactersPrompt = `\nPersonagens já conhecidos:\n${list}\n`;
  }

  const workTitle = params.projectMetadata?.workTitle ? ` da obra "${params.projectMetadata.workTitle}"` : '';

  const systemPrompt = `Você é um Diretor Narrativo e Supervisor Sênior de Roteiros para canais de Recap de Manhwa no YouTube${workTitle}.
Sua missão é extrair a BÍBLIA FÁTICA do capítulo ${params.chapterLabel}.

OBJETIVO CRÍTICO (ANTI-ALUCINAÇÃO):
O roteirista posterior receberá recortes de 2 em 2 páginas. Se ele não souber quem são os personagens de verdade, ele cometerá erros grosseiros — como julgar guerreiros veteranos suicidas e insanos como 'novatos preguiçosos' só porque estavam sentados, sujos ou zombando no início da batalha.
Você DEVE enxergar a história macro e estabelecer as verdades inegociáveis.

${knownCharactersPrompt}

DIRETRIZES DA ANÁLISE:
1. IDENTIDADE E FORÇA REAL:
   - Quem são os personagens e esquadrões em cena?
   - Qual a verdadeira postura psicológica e poder de combate deles?
   - Se eles agem com deboche ou calmaria em meio ao perigo, identifique que se trata da frieza de guerreiros que não temem a morte (e NÃO desleixo amador).
2. ARCO COMPLETO DO CAPÍTULO:
   - Qual a situação de abertura, o desenrolar das ações e o clímax/desfecho deste capítulo?
3. REGRAS OBRIGATÓRIAS ANTI-ALUCINAÇÃO:
   - Crie 3 a 5 regras enfáticas para guiar o narrador.

Retorne ESTRITAMENTE em formato JSON:
{
  "synopsis": "Resumo de 3 a 5 frases do enredo macro do capítulo",
  "characterDynamics": "Explicação clara e detalhada sobre quem são os personagens em cena, sua real força/experiência e relacionamento",
  "criticalRules": [
    "Regra 1: O esquadrão em cena é composto por veteranos assassinos insanos e muito fortes; NUNCA os descreva como amadores ou preguiçosos.",
    "Regra 2: ...",
    "Regra 3: ..."
  ],
  "suggestedWorkTitle": "Nome provável da obra se visível na arte ou logotipo",
  "detectedCharacters": [
    {
      "name": "Nome provável",
      "role": "protagonist",
      "description": "Breve descrição fática da índole e poder"
    }
  ]
}`;

  const userContent: any[] = [
    {
      type: 'text',
      text: `Aqui estão ${validSampled.length} páginas estratégicas do capítulo ${params.chapterLabel} (Páginas: ${validSampled.map((p) => p.pageNumber).join(', ')}). Analise a visão macro e retorne a Bíblia Fática em JSON:`,
    },
  ];

  for (const s of validSampled) {
    userContent.push({
      type: 'text',
      text: `--- Página ${s.pageNumber} ---`,
    });
    userContent.push({
      type: 'image_url',
      image_url: { url: s.b64 },
    });
  }

  const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
  const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const payload = {
    model: config.model || DEFAULT_AI_CONFIG.model,
    stream: false,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.4,
    max_tokens: 2200,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream, */*',
  };
  const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Erro na API durante análise macro do capítulo (${response.status}): ${errText.slice(0, 250)}`);
  }

  const rawRes = await response.text();
  const decoded = decodeSseOrJson(rawRes);

  let cleanJson = decoded.trim();
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
  }
  const firstBrace = cleanJson.indexOf('{');
  const lastBrace = cleanJson.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(cleanJson);
  } catch (err: any) {
    console.warn('Aviso: Falha ao fazer parse estrito do JSON da análise macro:', err);
    parsed = {
      synopsis: decoded.slice(0, 500),
      characterDynamics: 'Conforme arte e descrições.',
      criticalRules: ['Respeite o tom sério e a força dos personagens em cena.'],
    };
  }

  params.onProgress?.({
    stage: 'Bíblia fática do capítulo consolidada!',
    current: 3,
    total: 3,
  });

  return {
    synopsis: String(parsed.synopsis || params.chapterMetadata?.synopsis || '').trim(),
    characterDynamics: String(parsed.characterDynamics || '').trim(),
    criticalRules: Array.isArray(parsed.criticalRules)
      ? parsed.criticalRules.map((r: any) => String(r).trim()).filter(Boolean)
      : [],
    suggestedWorkTitle: parsed.suggestedWorkTitle ? String(parsed.suggestedWorkTitle).trim() : undefined,
    detectedCharacters: Array.isArray(parsed.detectedCharacters)
      ? parsed.detectedCharacters.map((c: any) => ({
          id: `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: String(c.name || 'Personagem'),
          aliases: [],
          role: (['protagonist', 'ally', 'antagonist', 'neutral'].includes(c.role) ? c.role : 'ally') as any,
          description: String(c.description || ''),
        }))
      : undefined,
  };
}

/**
 * Geração multimodal robusta e rápida em mini-blocos (chunking de 2 a 3 páginas).
 * Envia as imagens com Set-of-Mark e gera os roteiros diretamente vendo a arte,
 * guiada pela Bíblia Macro do Capítulo para eliminar alucinações e com paralelização.
 */
export async function generateChapterNarrationInMiniBatches(params: {
  chapterLabel: string;
  pages: ChapterPageItem[];
  profileId: string;
  customSystemPrompt?: string;
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: ChapterMetadata;
  config?: AiNarrationConfig;
  batchSize?: number;
  concurrency?: number;
  onProgress?: (info: { stage: string; current?: number; total?: number }) => void;
  onMacroContextReady?: (macro: ChapterMacroContext, detectedChars?: CharacterMetadata[], suggestedTitle?: string) => void;
}): Promise<ChapterNarrationResult> {
  const config = params.config || loadAiNarrationConfig();
  const validPages = params.pages.filter((p) => p.croppedFramesCount > 0 && p.rawImageUrl);
  if (validPages.length === 0) {
    throw new Error('Nenhuma página com quadros recortados e imagem disponível encontrada.');
  }

  let activeChapterMetadata = { ...(params.chapterMetadata || { chapterId: 'current' }) };
  let detectedCharacters: CharacterMetadata[] | undefined;
  let suggestedWorkTitle: string | undefined;

  // FASE 1: Se a Bíblia Macro ainda não existe, gera automaticamente para impedir alucinações
  if (!activeChapterMetadata.macroContext) {
    params.onProgress?.({
      stage: 'Fase 1: Extraindo Bíblia Fática e verdade dos personagens...',
      current: 0,
      total: 100,
    });

    try {
      const macroRes = await analyzeChapterMacroContext({
        chapterLabel: params.chapterLabel,
        pages: validPages,
        projectMetadata: params.projectMetadata,
        chapterMetadata: activeChapterMetadata,
        config,
        onProgress: (p) => params.onProgress?.({ stage: p.stage }),
      });

      const newMacro: ChapterMacroContext = {
        synopsis: macroRes.synopsis,
        characterDynamics: macroRes.characterDynamics,
        criticalRules: macroRes.criticalRules,
        suggestedWorkTitle: macroRes.suggestedWorkTitle,
        analyzedAt: Date.now(),
      };

      activeChapterMetadata = {
        ...activeChapterMetadata,
        synopsis: macroRes.synopsis || activeChapterMetadata.synopsis,
        macroContext: newMacro,
      };

      detectedCharacters = macroRes.detectedCharacters;
      suggestedWorkTitle = macroRes.suggestedWorkTitle;
      params.onMacroContextReady?.(newMacro, detectedCharacters, suggestedWorkTitle);
    } catch (err: any) {
      console.warn('Aviso: Análise macro falhou ou foi ignorada, prosseguindo com dados existentes:', err);
    }
  }

  // FASE 2: Chunking em mini-blocos (2 páginas por padrão)
  const batchSize = Math.max(1, Math.min(3, params.batchSize || 2));
  const chunks: ChapterPageItem[][] = [];
  for (let i = 0; i < validPages.length; i += batchSize) {
    chunks.push(validPages.slice(i, i + batchSize));
  }

  const concurrency = Math.max(1, Math.min(3, params.concurrency ?? 2));
  const chunkResults: (ChapterNarrationResult['paginas'] | null)[] = new Array(chunks.length).fill(null);
  let chapterSummary = activeChapterMetadata.macroContext?.synopsis || activeChapterMetadata.synopsis || '';
  let completedChunks = 0;

  // Processa blocos com concorrência para cortar o tempo de geração pela metade
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batchGroup = chunks.slice(i, i + concurrency);

    await Promise.all(
      batchGroup.map(async (chunk, relIdx) => {
        const chunkIdx = i + relIdx;
        const pageNums = chunk.map((p) => p.pageNumber).join(', ');

        params.onProgress?.({
          stage: `Gerando narração multimodal (Págs ${pageNums} - Bloco ${chunkIdx + 1}/${chunks.length})...`,
          current: completedChunks + 1,
          total: chunks.length,
        });

        // 1. Prepara imagens SoM daquele chunk em paralelo com tamanho otimizado
        const userContent: any[] = [];
        const chunkPhase =
          chunkIdx === 0
            ? 'Início do capítulo / Estabelecimento da atmosfera'
            : chunkIdx === chunks.length - 1
            ? 'Desfecho e clímax/gancho do capítulo'
            : 'Desenvolvimento e escalada da ação';

        const promptHeader = `Capítulo: ${params.chapterLabel}
Mini-bloco a narrar: Páginas ${pageNums} (Bloco ${chunkIdx + 1} de ${chunks.length}).
Fase da narrativa: ${chunkPhase}.
Analise os quadros demarcados com Set-of-Mark nas páginas abaixo e retorne o JSON com as cenas narradas:`;

        userContent.push({ type: 'text', text: promptHeader });

        const preparedPages = await Promise.all(
          chunk.map(async (page) => {
            let b64 = '';
            try {
              if (page.frames && page.frames.length > 0) {
                b64 = await generateSoMAnnotatedPage({
                  rawImageUrl: page.rawImageUrl,
                  frames: page.frames,
                  maxWidth: 960,
                  maxHeight: 1600,
                  quality: 0.72,
                });
              } else {
                b64 = await prepareImageForAi(page.rawImageUrl, 960, 1600);
              }
            } catch (err: any) {
              b64 = await prepareImageForAi(page.rawImageUrl, 960, 1600);
            }
            return { page, b64 };
          })
        );

        for (const { page, b64 } of preparedPages) {
          const labelsList = (
            page.croppedFramesLabels && page.croppedFramesLabels.length > 0
              ? page.croppedFramesLabels
              : ['Quadro 01']
          ).join(', ');

          userContent.push({
            type: 'text',
            text: `--- PÁGINA ${page.pageNumber} (${page.croppedFramesCount} quadros: [${labelsList}]) ---`,
          });
          userContent.push({
            type: 'image_url',
            image_url: { url: b64 },
          });
        }

        const systemPrompt = buildChapterNarrationSystemPrompt(
          params.profileId,
          params.customSystemPrompt,
          params.projectMetadata,
          activeChapterMetadata
        );

        const base = (config.baseURL || DEFAULT_AI_CONFIG.baseURL).replace(/\/+$/, '');
        const endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

        const payload = {
          model: config.model || DEFAULT_AI_CONFIG.model,
          stream: false,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: config.temperature ?? 0.72,
          max_tokens: 3000,
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream, */*',
        };
        const apiKey = (config.apiKey ?? DEFAULT_AI_CONFIG.apiKey).trim();
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Erro na API ao gerar bloco de páginas ${pageNums} (${response.status}): ${errText.slice(0, 250)}`);
        }

        const rawRes = await response.text();
        const decoded = decodeSseOrJson(rawRes);

        let cleanJson = decoded.trim();
        if (cleanJson.startsWith('```')) {
          cleanJson = cleanJson.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        }
        const firstBrace = cleanJson.indexOf('{');
        const lastBrace = cleanJson.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          cleanJson = cleanJson.slice(firstBrace, lastBrace + 1);
        }

        const chunkPaginas: ChapterNarrationResult['paginas'] = [];
        try {
          const parsed = JSON.parse(cleanJson);
          if (parsed.resumo_capitulo && !chapterSummary) {
            chapterSummary = parsed.resumo_capitulo;
          }

          const chunkPages = Array.isArray(parsed.paginas) ? parsed.paginas : [];

          chunk.forEach((pageItem) => {
            const found = chunkPages.find((p: any) => Number(p.pagina_numero || p.pagina) === pageItem.pageNumber);
            let rawCenas = found && Array.isArray(found.cenas) ? found.cenas : [];

            if (rawCenas.length === 0 && found?.roteiro) {
              rawCenas = [{ quadro_id: 'Quadro 01', roteiro_cena: found.roteiro, duracao_segundos: 6.5 }];
            }

            const usedIndices = new Set<number>();
            const pageFrames = pageItem.frames || [];
            const cenas: AiSceneResultItem[] = pageFrames.map((frame, cIdx) => {
              const matched: any = matchAiSceneToFrame(frame, cIdx, rawCenas, usedIndices);
              const rawScript = String(matched?.roteiro_cena || matched?.roteiro || matched?.text || '').trim();

              const clampedScript = clampFrameWords(rawScript, 24);
              const rawDur = parseFloat(matched?.duracao_segundos || 6.5);
              const speechMin = calculateRequiredSpeechDuration(clampedScript);
              const dur = Math.min(9.5, Math.max(5.0, !isNaN(rawDur) ? Math.min(rawDur, 9.5) : speechMin));

              return {
                quadro_id: frame.label || `Quadro ${cIdx + 1}`,
                roteiro_cena: clampedScript,
                duracao_segundos: Number(dur.toFixed(1)),
                transicao: normalizeTransitionType(matched?.transicao || matched?.transition, cIdx),
              };
            });

            // DEDUP: Garante que nenhuma página fique com falas repetidas entre quadros
            const scriptsList = cenas.map((c) => c.roteiro_cena.trim());
            const uniqueScripts = new Set(scriptsList.filter(Boolean));
            const hasDuplicateText = scriptsList.length > 1 && uniqueScripts.size < scriptsList.length;

            if (hasDuplicateText || (rawCenas.length < pageFrames.length && pageFrames.length > 1)) {
              const pageFullText = (
                found?.roteiro ||
                rawCenas.map((r: any) => r.roteiro_cena || r.roteiro || '').join(' ') ||
                scriptsList.join(' ')
              ).trim();
              if (pageFullText) {
                const distributed = distributeTextToFrames(pageFullText, pageFrames);
                cenas.forEach((c, idx) => {
                  if (distributed[idx]) {
                    c.roteiro_cena = clampFrameWords(distributed[idx], 24);
                  }
                });
              }
            }

            const combined = cenas.map((c) => c.roteiro_cena).filter(Boolean).join(' ');
            chunkPaginas.push({
              pagina_numero: pageItem.pageNumber,
              cenas,
              roteiro: combined,
            });
          });
        } catch (err: any) {
          throw new Error(`Falha ao decodificar JSON do bloco de páginas ${pageNums}: ${err.message}`);
        }

        chunkResults[chunkIdx] = chunkPaginas;
        completedChunks++;
      })
    );
  }

  // Monta todas as páginas preservando a ordem original
  const allPaginas: ChapterNarrationResult['paginas'] = [];
  chunkResults.forEach((cPages) => {
    if (cPages) {
      allPaginas.push(...cPages);
    }
  });

  return {
    resumo_capitulo: chapterSummary,
    paginas: allPaginas,
    macroContext: activeChapterMetadata.macroContext,
    suggestedWorkTitle,
    detectedCharacters,
  };
}

export function generateScriptSuggestion(presetId: string, currentText?: string): string {
  const profile = NARRATION_PROFILES.find((p) => p.id === presetId) || NARRATION_PROFILES[0];
  return `Sob o perfil ${profile.name}: com mais um movimento decisivo, o combate tomava um rumo irreversível...`;
}
