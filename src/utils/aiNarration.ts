/**
 * AI & Smart Script Generator for Manga/Manhwa Recaps
 * Generates compelling YouTube-style recap narrations from raw page images.
 * Powered by OpenAI-compatible vision endpoints (9router, local LLMs, or cloud models).
 */

import { FrameItem, TransitionType } from '../types';
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

export const DEFAULT_AI_CONFIG: AiNarrationConfig = {
  provider: '9router',
  baseURL: 'https://rg5g7il.abc-tunnel.us/v1',
  apiKey: 'sk-9f0701a12df427ea-ktrke6-b72acfe0',
  model: 'ag/gemini-3.8-flash-high',
  ttsModel: 'edge-tts/pt-BR-AntonioNeural',
  stylePreset: 'sarcastico',
  temperature: 0.72,
};

const STORAGE_KEY_CONFIG = 'mec_recap_ai_config';

export function loadAiNarrationConfig(): AiNarrationConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.baseURL || parsed.baseURL === 'http://127.0.0.1:20128/v1') {
        parsed.baseURL = 'https://rg5g7il.abc-tunnel.us/v1';
      }
      // Migrate legacy default gemini voice to the requested edge-tts AntonioNeural
      let ttsModel = parsed.ttsModel || DEFAULT_AI_CONFIG.ttsModel;
      if (!ttsModel || ttsModel.includes('gemini-3.1-flash-tts-preview/Fenrir')) {
        ttsModel = 'edge-tts/pt-BR-AntonioNeural';
      }
      return {
        ...DEFAULT_AI_CONFIG,
        ...parsed,
        apiKey: parsed.apiKey || DEFAULT_AI_CONFIG.apiKey,
        ttsModel,
      };
    }
  } catch {}
  return DEFAULT_AI_CONFIG;
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
 * Passo D: Distribuição Ponderada por Duração Real do Áudio
 * Fórmula: Tempo_Cena_i = audio.duration * (Palavras_Cena_i / Total_Palavras_Pagina)
 * Injeta o tempo calculado no valor de cada quadro/slider (arredondado para 1 casa decimal).
 * Garante que a soma de todos os tempos das cenas seja rigorosamente igual a audio.duration,
 * evitando silêncio excedente ou cortes de fala no final.
 */
export function calculateWeightedSceneDurations(
  frames: { id: string; narrationSnippet?: string; label?: string }[],
  totalAudioDuration: number,
  fallbackFullText?: string
): { id: string; duration: number }[] {
  if (!frames || frames.length === 0) return [];

  const targetTotal = Number(totalAudioDuration.toFixed(1));

  if (frames.length === 1) {
    return [{ id: frames[0].id, duration: Math.max(1.0, targetTotal) }];
  }

  // Conta a quantidade de palavras de cada cena
  let wordCounts = frames.map((f) => {
    const txt = (f.narrationSnippet || '').trim();
    return txt ? txt.split(/\s+/).filter(Boolean).length : 0;
  });

  // Se os snippets individuais estiverem vazios, divide o texto completo da página proporcionalmente
  const totalSnippetWords = wordCounts.reduce((a, b) => a + b, 0);
  if (totalSnippetWords === 0 && fallbackFullText && fallbackFullText.trim()) {
    const allWords = fallbackFullText.trim().split(/\s+/).filter(Boolean);
    const wordsPerFrame = Math.max(1, Math.floor(allWords.length / frames.length));
    wordCounts = frames.map((_, idx) => {
      if (idx === frames.length - 1) {
        return Math.max(1, allWords.length - wordsPerFrame * (frames.length - 1));
      }
      return wordsPerFrame;
    });
  }

  // Assegura peso mínimo de 1 para evitar divisão por 0
  const safeWeights = wordCounts.map((w) => Math.max(1, w));
  const totalWeight = safeWeights.reduce((a, b) => a + b, 0);

  // Mínimo por cena para evitar flash imperceptível
  const minPerScene = targetTotal >= frames.length * 1.0 ? 1.0 : Math.max(0.5, Number((targetTotal / frames.length).toFixed(1)));

  // Proporção matemática inicial: audio.duration * (Palavras_Cena_i / Total_Palavras_Pagina)
  const durations = safeWeights.map((w) => {
    const rawVal = (targetTotal * w) / totalWeight;
    return Math.max(minPerScene, Number(rawVal.toFixed(1)));
  });

  // Calcula discrepância decorrente de arredondamento para 1 casa decimal
  let currentSum = Number(durations.reduce((acc, d) => acc + d, 0).toFixed(1));
  let diff = Number((targetTotal - currentSum).toFixed(1));

  // Ajusta os décimos (±0.1s) nas cenas com maior peso para garantir que a soma seja rigorosamente igual a targetTotal
  let iterations = 0;
  while (Math.abs(diff) >= 0.05 && iterations < 50) {
    iterations++;
    if (diff > 0) {
      // Falta tempo: adiciona +0.1s à cena com maior peso
      let bestIdx = 0;
      for (let i = 1; i < durations.length; i++) {
        if (safeWeights[i] > safeWeights[bestIdx]) {
          bestIdx = i;
        }
      }
      durations[bestIdx] = Number((durations[bestIdx] + 0.1).toFixed(1));
      diff = Number((diff - 0.1).toFixed(1));
    } else {
      // Sobra tempo: subtrai -0.1s da cena com maior duração (respeitando o mínimo de segurança)
      let maxIdx = -1;
      let maxVal = -Infinity;
      for (let i = 0; i < durations.length; i++) {
        if (durations[i] > minPerScene && durations[i] > maxVal) {
          maxVal = durations[i];
          maxIdx = i;
        }
      }
      if (maxIdx >= 0) {
        durations[maxIdx] = Number((durations[maxIdx] - 0.1).toFixed(1));
        diff = Number((diff + 0.1).toFixed(1));
      } else {
        break;
      }
    }
  }

  return frames.map((f, idx) => ({
    id: f.id,
    duration: Number(durations[idx].toFixed(1)),
  }));
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

  let base = (config.baseURL || 'https://rg5g7il.abc-tunnel.us/v1').replace(/\/+$/, '');
  const ttsUrl = base.endsWith('/v1') ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
  const model =
    options.model || config.ttsModel || 'edge-tts/pt-BR-AntonioNeural';
  const apiKey = config.apiKey || 'sk-9f0701a12df427ea-ktrke6-b72acfe0';

  const payload = {
    model,
    input: text,
  };

  const response = await fetch(ttsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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

/**
 * Tests connection to the 9router / OpenAI-compatible endpoint
 */
export async function testAiConnection(config: AiNarrationConfig): Promise<{
  success: boolean;
  message: string;
}> {
  const base = config.baseURL.replace(/\/+$/, '');
  const url = `${base}/models`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json().catch(() => null);
      const modelCount = data?.data?.length || 0;
      return {
        success: true,
        message: `Conexão bem-sucedida com o 9router! (${modelCount > 0 ? `${modelCount} modelos disponíveis` : 'Online'})`,
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
          `Não foi possível conectar em ${config.baseURL}. Verifique se o túnel ou 9router está ativo.`,
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
function decodeSseOrJson(rawText: string): string {
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
 * Builds the exact Backend System Prompt for Chapter-wide Recap Generation (Atomic per-scene granularity)
 */
export function buildChapterNarrationSystemPrompt(profileId: string = 'sarcastico'): string {
  const profile = NARRATION_PROFILES.find((p) => p.id === profileId) || NARRATION_PROFILES[0];

  return `Você é um Roteirista Profissional de Canais de Recap de Manhwa no YouTube (especialista em retenção e storytelling falado).

OBJETIVO:
Criar uma narrativa contínua, ágil e envolvente para acompanhar a sequência de quadros recortados. 

PERFIL ATIVO DO NARRADOR: ${profile.name}
- Cúmplice & Sarcástico: Debochado, fala com o espectador, tira sarro da arrogância dos vilões e celebra o contra-ataque do prota.
- Cronista Épico: Dramático, cinematográfico, usa pausas e vocabulário solene, focado no peso dramático de cada golpe.
- Analista Tático: Foco na frieza do prota, dedução das fraquezas do oponente e explicação rápida das regras de poder/sistema.
- Dinâmico de Retenção: Frases curtas, ritmo frenético, inserindo ganchos contínuos ("Mas o pior ainda estava por vir...").

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

5. RITMO E EXTENSÃO CALIBRADA (5.0s A 10.0s POR CENA):
   - Duração por cena ("duracao_segundos"): OBRIGATORIAMENTE entre 5.0 e 10.0 segundos, ajustada conforme o peso e a intensidade de cada cena.
   - Cada quadro recortado ("roteiro_cena") deve conter entre 12 e 25 palavras, proporcionando tempo suficiente para o narrador contextualizar, transmitir o impacto emocional e criar ganchos naturais sem pressa.
   - Fidelidade Temporal Rigorosa: A fala deve descrever com clareza e ritmo natural EXATAMENTE a ação e emoção do quadro ATUAL, sem antecipar o quadro posterior e sem arrastar resquícios do quadro anterior.

6. TRANSIÇÕES PERMITIDAS:
   - Escolha para cada cena: "zoom_in", "zoom_out", "pan_down", "pan_up", "fade", "corte_seco". Varie sem repetir consecutivamente.

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

  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;

  const payload = {
    model: config.model,
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream, */*',
      Authorization: `Bearer ${config.apiKey}`,
    },
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
}): Promise<PageNarrationResult> {
  const config = params.config || loadAiNarrationConfig();
  const profileId = params.stylePresetId || config.stylePreset || 'sarcastico';
  const profile = NARRATION_PROFILES.find((p) => p.id === profileId) || NARRATION_PROFILES[0];
  const systemPrompt = buildChapterNarrationSystemPrompt(profile.id);

  let base64Image = '';
  try {
    if (params.frames && params.frames.length > 0) {
      base64Image = await generateSoMAnnotatedPage({
        rawImageUrl: params.rawImageUrl,
        frames: params.frames,
        maxWidth: 1200,
        maxHeight: 2000,
      });
    } else {
      base64Image = await prepareImageForAi(params.rawImageUrl, 1200, 2000);
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
4. RITMO E EXTENSÃO CALIBRADA (5.0s A 10.0s POR CENA):
   - Duração por cena ("duracao_segundos"): OBRIGATORIAMENTE entre 5.0 e 10.0 segundos, ajustada conforme a intensidade dramática da cena.
   - Cada quadro recortado ("roteiro_cena"): entre 12 e 25 palavras, proporcionando tempo suficiente para o narrador contextualizar, transmitir o impacto e criar ganchos naturais sem pressa.
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
          "roteiro_cena": "Frase de 12 a 25 palavras com storytelling vívido e conectivos naturais para este momento...",
          "duracao_segundos": 6.8,
          "transicao": "${idx % 2 === 0 ? 'zoom_in' : 'zoom_out'}"
        }`
          )
          .join(',\n        ')}
      ]
    }
  ]
}`;

  const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;

  const payload = {
    model: config.model,
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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream, */*',
      Authorization: `Bearer ${config.apiKey}`,
    },
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

export function generateScriptSuggestion(presetId: string, currentText?: string): string {
  const profile = NARRATION_PROFILES.find((p) => p.id === presetId) || NARRATION_PROFILES[0];
  return `Sob o perfil ${profile.name}: com mais um movimento decisivo, o combate tomava um rumo irreversível...`;
}
