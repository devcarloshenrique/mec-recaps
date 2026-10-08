export type AspectRatio = '9:16' | '1:1' | '4:3' | '16:9' | 'Livre';

export type TransitionType = 'cut' | 'fade' | 'zoom_in' | 'zoom_out' | 'pan_down';

export const TRANSITION_OPTIONS: { id: TransitionType; label: string; description: string }[] = [
  { id: 'cut', label: 'Corte Seco (Nenhum)', description: 'Troca instantânea sem efeito' },
  { id: 'fade', label: 'Fade In / Out', description: 'Transição suave de opacidade' },
  { id: 'zoom_in', label: 'Zoom Lento (Ken Burns In)', description: 'Aproximação lenta do quadro' },
  { id: 'zoom_out', label: 'Zoom Lento (Ken Burns Out)', description: 'Afastamento lento do quadro' },
  { id: 'pan_down', label: 'Pan Vertical (Top to Bottom)', description: 'Deslizamento vertical de cima para baixo' },
];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameItem {
  id: string;
  label: string;
  src: string;
  ratio: string;
  duration: number; // in seconds
  chapterId?: string;
  pageNumber?: number;
  panelId?: string;
  cropRect?: CropRect;
  blob?: Blob;
  transition?: TransitionType;
  narrationSnippet?: string;
}

export interface SceneItem {
  id: string;
  title: string;
  frames: FrameItem[];
  voice: string;
  duration: string;
  text: string;
  chapterId?: string;
  pageNumber?: number;
  rawPageUrl?: string;
  status?: 'idle' | 'generating' | 'done' | 'error';
  error?: string;
  audioUrl?: string;
  audioBlob?: Blob;
  audioDuration?: number;
  audioModel?: string;
}

export interface ChapterItem {
  id: string;
  label: string;
  pages: number;
  done: number;
  imageUrls?: string[];
  files?: File[];
  pageBlobs?: Blob[];
}

export type StudioTab = 'recorte' | 'roteiro' | 'narracao' | 'montagem';

// Metadados de Personagens e Universo
export type CharacterRole = 'protagonist' | 'ally' | 'antagonist' | 'neutral';

export interface CharacterMetadata {
  id: string;
  name: string;
  aliases: string[];       // ex: ["Sung Jinwoo", "Monarca das Sombras", "Jinwoo"]
  role: CharacterRole;
  description?: string;
}

export interface ProjectMetadata {
  workTitle: string;        // Nome da obra (ex: "Solo Leveling")
  universeLore?: string;    // Resumo do cenário/sistema de poder
  glossary: Record<string, string>; // { "Dungeon Rank C": "Masmorra perigosa", "Mana": "Energia mágica" }
  characters: CharacterMetadata[];
}

export interface ChapterMacroContext {
  synopsis: string;                 // Visão geral dos acontecimentos do capítulo
  characterDynamics: string;        // Quem são os personagens em cena, sua real força/índole e dinâmica
  criticalRules: string[];          // Diretrizes obrigatórias anti-alucinação
  suggestedWorkTitle?: string;      // Título provável sugerido na análise
  analyzedAt?: number;
}

export interface ChapterMetadata {
  chapterId: string;
  synopsis?: string;
  macroContext?: ChapterMacroContext;
  guestCharacters?: CharacterMetadata[];
}

// 1. Extração bruta via visão computacional (Multimodal)
export interface RawPanelContext {
  frameId: string;
  panelLabel: string;             // ex: "[Quadro 01]"
  visualAction: string;          // Descrição objetiva da ação visual e poses
  dialogues: string[];           // Balões de fala/pensamento transcritos
  charactersIdentified: string[];// Nomes dos personagens identificados
  mood: string;                  // 'tensão' | 'batalha' | 'cômico' | 'mistério' | etc.
}

// 2. Perfis de Narração (Text-Only)
export interface ScriptProfile {
  id: string;                     // ex: 'profile_epic', 'profile_tiktok', 'profile_custom_1'
  name: string;                   // ex: 'Épico / Recap Tradicional', 'Ácido / Sarcástico'
  systemPromptPreset?: string;
  snippetsByFrameId: Record<string, string>; // { [frameId]: "Texto narrado daquele recorte" }
  fullScriptText: string;         // Concatenação de leitura contínua da cena
  createdAt: number;
}

// 3. Estado consolidado do roteiro por página/cena
export interface PageScriptState {
  pageNumber: number;
  chapterId: string;
  rawContext: RawPanelContext[];
  activeProfileId: string;
  profiles: ScriptProfile[];
}

