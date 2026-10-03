import { get, set, del } from 'idb-keyval';
import { ChapterItem, FrameItem, SceneItem, StudioTab, TransitionType, CropRect } from '../types';
import { DetectedPanel } from './panelDetection';

export const STORAGE_KEY_PROJECT = 'recap_current_project';

export interface StoredChapter {
  id: string;
  label: string;
  pages: number;
  done: number;
  pageBlobs: Blob[];
}

export interface StoredFrame {
  id: string;
  label: string;
  ratio: string;
  duration: number;
  chapterId?: string;
  pageNumber?: number;
  transition?: TransitionType;
  narrationSnippet?: string;
  cropBlob: Blob;
  panelId?: string;
  cropRect?: CropRect;
}

export interface StoredScene {
  id: string;
  title: string;
  frameIds: string[];
  voice: string;
  duration: string;
  text: string;
  chapterId?: string;
  pageNumber?: number;
  status?: 'idle' | 'generating' | 'done' | 'error';
  audioDuration?: number;
  audioModel?: string;
  audioBlob?: Blob;
}

export interface StoredProjectState {
  version: number;
  updatedAt: number;
  title?: string;
  currentChapterId: string;
  currentPageNumber: number;
  currentTab?: StudioTab;
  chapters: StoredChapter[];
  frames: StoredFrame[];
  scenes: StoredScene[];
  chapterPanels?: Record<string, Record<number, DetectedPanel[]>>;
  globalConfig?: Record<string, any>;
}

export interface ProjectStateToSave {
  chapters: ChapterItem[];
  frames: FrameItem[];
  scenes: SceneItem[];
  chapterPanels?: Record<string, Record<number, DetectedPanel[]>>;
  currentChapterId?: string;
  currentPageNumber?: number;
  currentTab?: StudioTab;
  title?: string;
  globalConfig?: Record<string, any>;
}

export interface HydratedProjectState {
  chapters: ChapterItem[];
  frames: FrameItem[];
  scenes: SceneItem[];
  chapterPanels?: Record<string, Record<number, DetectedPanel[]>>;
  currentChapterId: string;
  currentPageNumber: number;
  currentTab?: StudioTab;
  title?: string;
  updatedAt: number;
}

// Registry to track created Object URLs so we can revoke them on reload / clear
const activeCreatedUrls = new Set<string>();

export function registerCreatedUrl(url: string): string {
  if (url && url.startsWith('blob:')) {
    activeCreatedUrls.add(url);
  }
  return url;
}

export function revokeAllCreatedUrls(): void {
  activeCreatedUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  activeCreatedUrls.clear();
}

/**
 * Converts a string (dataURL, blob URL, or relative asset URL) or File/Blob into a native Blob.
 */
async function toNativeBlob(source: string | Blob | File): Promise<Blob> {
  if (source instanceof Blob) {
    return source;
  }
  if (typeof source === 'string') {
    // Fetch works transparently on data: URLs, blob: URLs, and local relative paths
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`Falha ao converter recurso para Blob: ${source.substring(0, 30)}...`);
    }
    return await response.blob();
  }
  throw new Error('Tipo de fonte inválido para conversão em Blob');
}

/**
 * Serializes and saves the complete project state and native Blobs into IndexedDB
 */
export async function saveProject(state: ProjectStateToSave): Promise<boolean> {
  try {
    const {
      chapters,
      frames,
      scenes,
      currentChapterId = '',
      currentPageNumber = 1,
      currentTab = 'recorte',
      title = 'Projeto Manhwa Recap',
      globalConfig = {},
    } = state;

    // 1. Process Chapters: convert page images into native Blobs
    const storedChapters: StoredChapter[] = [];
    for (const ch of chapters) {
      const pageBlobs: Blob[] = [];

      // Check if pageBlobs already attached
      if (ch.pageBlobs && ch.pageBlobs.length > 0) {
        pageBlobs.push(...ch.pageBlobs);
      } else if (ch.files && ch.files.length > 0) {
        // Files are already Blobs
        pageBlobs.push(...ch.files);
      } else if (ch.imageUrls && ch.imageUrls.length > 0) {
        for (const url of ch.imageUrls) {
          try {
            const blob = await toNativeBlob(url);
            pageBlobs.push(blob);
          } catch (err) {
            console.warn(`Aviso ao converter imagem da página para Blob (${ch.label}):`, err);
          }
        }
      }

      storedChapters.push({
        id: ch.id,
        label: ch.label,
        pages: pageBlobs.length > 0 ? pageBlobs.length : ch.pages,
        done: ch.done || 0,
        pageBlobs,
      });
    }

    // 2. Process Frames: convert crop visual to native Blob
    const storedFrames: StoredFrame[] = [];
    for (const f of frames) {
      let cropBlob: Blob | null = f.blob || null;

      if (!cropBlob && f.src) {
        try {
          cropBlob = await toNativeBlob(f.src);
        } catch (err) {
          console.warn(`Aviso ao converter quadro ${f.label} para Blob:`, err);
        }
      }

      if (cropBlob) {
        storedFrames.push({
          id: f.id,
          label: f.label,
          ratio: f.ratio,
          duration: f.duration,
          chapterId: f.chapterId,
          pageNumber: f.pageNumber,
          transition: f.transition,
          narrationSnippet: f.narrationSnippet,
          cropBlob,
          panelId: f.panelId,
          cropRect: f.cropRect,
        });
      }
    }

    // 3. Process Scenes: preserve audio Blobs
    const storedScenes: StoredScene[] = [];
    for (const s of scenes) {
      let audioBlob: Blob | undefined = s.audioBlob;

      // If audioBlob not directly attached but audioUrl exists, extract blob
      if (!audioBlob && s.audioUrl) {
        try {
          audioBlob = await toNativeBlob(s.audioUrl);
        } catch (err) {
          console.warn(`Aviso ao converter áudio da cena ${s.title} para Blob:`, err);
        }
      }

      storedScenes.push({
        id: s.id,
        title: s.title,
        frameIds: s.frames.map((f) => f.id),
        voice: s.voice,
        duration: s.duration,
        text: s.text,
        chapterId: s.chapterId,
        pageNumber: s.pageNumber,
        status: s.status,
        audioDuration: s.audioDuration,
        audioModel: s.audioModel,
        audioBlob,
      });
    }

    const payload: StoredProjectState = {
      version: 1,
      updatedAt: Date.now(),
      title,
      currentChapterId,
      currentPageNumber,
      currentTab,
      chapters: storedChapters,
      frames: storedFrames,
      scenes: storedScenes,
      chapterPanels: state.chapterPanels || {},
      globalConfig,
    };

    await set(STORAGE_KEY_PROJECT, payload);
    return true;
  } catch (err) {
    console.error('Erro ao salvar projeto no IndexedDB:', err);
    return false;
  }
}

/**
 * Loads project state from IndexedDB, rehydrating Blobs into active object URLs
 */
export async function loadProject(): Promise<HydratedProjectState | null> {
  try {
    const data = await get<StoredProjectState>(STORAGE_KEY_PROJECT);
    if (!data || !data.chapters) {
      return null;
    }

    // 1. Rehydrate Frames: generate URL for each frame cropBlob
    const frameMap = new Map<string, FrameItem>();
    const hydratedFrames: FrameItem[] = [];

    for (const sf of data.frames || []) {
      const src = registerCreatedUrl(URL.createObjectURL(sf.cropBlob));
      const frame: FrameItem = {
        id: sf.id,
        label: sf.label,
        src,
        ratio: sf.ratio,
        duration: sf.duration,
        chapterId: sf.chapterId,
        pageNumber: sf.pageNumber,
        transition: sf.transition,
        narrationSnippet: sf.narrationSnippet,
        panelId: sf.panelId,
        cropRect: sf.cropRect,
        blob: sf.cropBlob,
      };
      frameMap.set(frame.id, frame);
      hydratedFrames.push(frame);
    }

    // 2. Rehydrate Chapters: generate URLs for raw manhwa pages
    const hydratedChapters: ChapterItem[] = [];
    for (const sc of data.chapters || []) {
      const imageUrls = (sc.pageBlobs || []).map((blob) => {
        return registerCreatedUrl(URL.createObjectURL(blob));
      });

      hydratedChapters.push({
        id: sc.id,
        label: sc.label,
        pages: sc.pages || imageUrls.length,
        done: sc.done || 0,
        imageUrls,
        pageBlobs: sc.pageBlobs,
      });
    }

    // 3. Rehydrate Scenes: link frames and regenerate audioUrl
    const hydratedScenes: SceneItem[] = [];
    for (const ss of data.scenes || []) {
      const matchedFrames = (ss.frameIds || [])
        .map((fId) => frameMap.get(fId))
        .filter((f): f is FrameItem => Boolean(f));

      let audioUrl: string | undefined = undefined;
      if (ss.audioBlob && ss.audioBlob.size > 0) {
        audioUrl = registerCreatedUrl(URL.createObjectURL(ss.audioBlob));
      }

      hydratedScenes.push({
        id: ss.id,
        title: ss.title,
        frames: matchedFrames,
        voice: ss.voice,
        duration: ss.duration,
        text: ss.text,
        chapterId: ss.chapterId,
        pageNumber: ss.pageNumber,
        status: ss.status || 'idle',
        audioUrl,
        audioBlob: ss.audioBlob,
        audioDuration: ss.audioDuration,
        audioModel: ss.audioModel,
      });
    }

    return {
      chapters: hydratedChapters,
      frames: hydratedFrames,
      scenes: hydratedScenes,
      chapterPanels: data.chapterPanels || {},
      currentChapterId: data.currentChapterId || hydratedChapters[0]?.id || '',
      currentPageNumber: data.currentPageNumber || 1,
      currentTab: data.currentTab || 'recorte',
      title: data.title || 'Projeto Manhwa Recap',
      updatedAt: data.updatedAt || Date.now(),
    };
  } catch (err) {
    console.error('Erro ao carregar projeto do IndexedDB:', err);
    return null;
  }
}

/**
 * Clears saved project from IndexedDB and revokes memory URLs
 */
export async function clearProject(): Promise<void> {
  try {
    await del(STORAGE_KEY_PROJECT);
    revokeAllCreatedUrls();
  } catch (err) {
    console.error('Erro ao limpar projeto no IndexedDB:', err);
  }
}

/**
 * Checks if a project is currently stored in IndexedDB
 */
export async function hasSavedProject(): Promise<boolean> {
  try {
    const data = await get<StoredProjectState>(STORAGE_KEY_PROJECT);
    return Boolean(data && data.chapters && data.chapters.length > 0);
  } catch {
    return false;
  }
}

/**
 * Gets high-level summary of the saved project (timestamp, item counts)
 */
export async function getSavedProjectInfo(): Promise<{
  updatedAt: number;
  chaptersCount: number;
  framesCount: number;
  scenesCount: number;
  title?: string;
} | null> {
  try {
    const data = await get<StoredProjectState>(STORAGE_KEY_PROJECT);
    if (!data) return null;
    return {
      updatedAt: data.updatedAt,
      chaptersCount: data.chapters?.length || 0,
      framesCount: data.frames?.length || 0,
      scenesCount: data.scenes?.length || 0,
      title: data.title,
    };
  } catch {
    return null;
  }
}
