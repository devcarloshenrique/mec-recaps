import { get, set, del } from 'idb-keyval';
import {
  ChapterItem,
  FrameItem,
  SceneItem,
  StudioTab,
  TransitionType,
  CropRect,
  ProjectMetadata,
  ChapterMetadata,
  PageScriptState,
} from '../types';
import { DetectedPanel } from './panelDetection';
import { deleteChapterThumbnails } from './thumbnailCache';

export const STORAGE_KEY_PROJECT = 'recap_current_project';
const STORAGE_KEY_CHAPTER_MEDIA_PREFIX = 'recap_chapter_media_';

// Set of chapter IDs whose media Blobs have already been saved to the isolated media store
const persistedMediaChapters = new Set<string>();

export async function saveChapterMediaBlobs(chapterId: string, blobs: Blob[]): Promise<void> {
  if (!chapterId || blobs.length === 0) return;
  try {
    await set(`${STORAGE_KEY_CHAPTER_MEDIA_PREFIX}${chapterId}`, blobs);
    persistedMediaChapters.add(chapterId);
  } catch (err) {
    console.error(`Erro ao salvar mídias do capítulo ${chapterId}:`, err);
  }
}

export async function getChapterMediaBlobs(chapterId: string): Promise<Blob[] | undefined> {
  if (!chapterId) return undefined;
  try {
    return await get<Blob[]>(`${STORAGE_KEY_CHAPTER_MEDIA_PREFIX}${chapterId}`);
  } catch (err) {
    console.error(`Erro ao carregar mídias do capítulo ${chapterId}:`, err);
    return undefined;
  }
}

export async function deleteChapterMediaBlobs(chapterId: string): Promise<void> {
  if (!chapterId) return;
  try {
    await del(`${STORAGE_KEY_CHAPTER_MEDIA_PREFIX}${chapterId}`);
    persistedMediaChapters.delete(chapterId);
  } catch (err) {
    console.error(`Erro ao excluir mídias do capítulo ${chapterId}:`, err);
  }
}

export interface StoredChapter {
  id: string;
  label: string;
  pages: number;
  done: number;
  pageBlobs?: Blob[];
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
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: Record<string, ChapterMetadata>;
  pageScripts?: Record<string, PageScriptState>;
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
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: Record<string, ChapterMetadata>;
  pageScripts?: Record<string, PageScriptState>;
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
  projectMetadata?: ProjectMetadata;
  chapterMetadata?: Record<string, ChapterMetadata>;
  pageScripts?: Record<string, PageScriptState>;
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

export function revokeCreatedUrl(url?: string): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
    activeCreatedUrls.delete(url);
  }
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
    if (source.startsWith('data:')) {
      const commaIdx = source.indexOf(',');
      if (commaIdx !== -1) {
        const mimeMatch = source.substring(0, commaIdx).match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const b64 = source.substring(commaIdx + 1);
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime });
      }
    }

    // Fetch works transparently on blob: URLs and local relative paths
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

    // 1. Process Chapters: Save heavy pageBlobs ONCE to isolated store, keep project JSON light (< 50 KB)
    const storedChapters: StoredChapter[] = [];
    for (const ch of chapters) {
      let pageBlobs: Blob[] = ch.pageBlobs || [];

      if (pageBlobs.length === 0 && ch.files && ch.files.length > 0) {
        pageBlobs = [...ch.files];
        ch.pageBlobs = pageBlobs;
      } else if (pageBlobs.length === 0 && ch.imageUrls && ch.imageUrls.length > 0) {
        for (const url of ch.imageUrls) {
          try {
            const blob = await toNativeBlob(url);
            pageBlobs.push(blob);
          } catch (err) {
            console.warn(`Aviso ao converter imagem da página para Blob (${ch.label}):`, err);
          }
        }
        ch.pageBlobs = pageBlobs;
      }

      // Save to isolated media store ONCE
      if (pageBlobs.length > 0 && !persistedMediaChapters.has(ch.id)) {
        await saveChapterMediaBlobs(ch.id, pageBlobs);
      }

      storedChapters.push({
        id: ch.id,
        label: ch.label,
        pages: pageBlobs.length > 0 ? pageBlobs.length : ch.pages,
        done: ch.done || 0,
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
        f.blob = cropBlob;
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
      projectMetadata: state.projectMetadata,
      chapterMetadata: state.chapterMetadata || {},
      pageScripts: state.pageScripts || {},
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

    // 2. Rehydrate Chapters: load Blobs from isolated media store
    const hydratedChapters: ChapterItem[] = [];
    let needsMigration = false;

    for (const sc of data.chapters || []) {
      let pageBlobs: Blob[] | undefined = sc.pageBlobs;

      // Check if this was a legacy project with embedded pageBlobs
      if (pageBlobs && pageBlobs.length > 0) {
        // Automatically migrate to isolated store!
        await saveChapterMediaBlobs(sc.id, pageBlobs);
        needsMigration = true;
      } else {
        // Load from isolated store
        pageBlobs = await getChapterMediaBlobs(sc.id);
        if (pageBlobs && pageBlobs.length > 0) {
          persistedMediaChapters.add(sc.id);
        }
      }

      const imageUrls = (pageBlobs || []).map((blob) => {
        return registerCreatedUrl(URL.createObjectURL(blob));
      });

      hydratedChapters.push({
        id: sc.id,
        label: sc.label,
        pages: sc.pages || imageUrls.length,
        done: sc.done || 0,
        imageUrls,
        pageBlobs: pageBlobs || [],
      });
    }

    // If legacy bloated data was found, clean it up immediately in IndexedDB
    if (needsMigration) {
      setTimeout(() => {
        saveProject({
          chapters: hydratedChapters,
          frames: hydratedFrames,
          scenes: hydratedScenes,
          currentChapterId: data.currentChapterId || '',
          currentPageNumber: data.currentPageNumber || 1,
          currentTab: data.currentTab || 'recorte',
          title: data.title || 'Projeto Manhwa Recap',
          chapterPanels: data.chapterPanels || {},
          projectMetadata: data.projectMetadata,
          chapterMetadata: data.chapterMetadata,
          pageScripts: data.pageScripts,
        }).then(() => {
          console.log('[IndexedDB] Migração concluída: Payload de projeto purificado para < 50KB!');
        });
      }, 500);
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
      projectMetadata: data.projectMetadata || {
        workTitle: data.title || '',
        universeLore: '',
        glossary: {},
        characters: [],
      },
      chapterMetadata: data.chapterMetadata || {},
      pageScripts: data.pageScripts || {},
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
    const data = await get<StoredProjectState>(STORAGE_KEY_PROJECT);
    if (data?.chapters) {
      for (const ch of data.chapters) {
        await deleteChapterMediaBlobs(ch.id);
        await deleteChapterThumbnails(ch.id);
      }
    }
    await del(STORAGE_KEY_PROJECT);
    persistedMediaChapters.clear();
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
