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

export type StudioTab = 'recorte' | 'narracao' | 'montagem';
