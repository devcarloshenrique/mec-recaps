import JSZip from 'jszip';
import {
  ChapterItem,
  FrameItem,
  SceneItem,
  ProjectMetadata,
  ChapterMetadata,
  PageScriptState,
  StudioTab,
} from '../types';
import { DetectedPanel } from './panelDetection';
import {
  getChapterMediaBlobs,
  registerCreatedUrl,
  HydratedProjectState,
  saveProject,
} from './projectStorage';

export type BundleMode = 'full' | 'compact';

export interface RecapManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: number;
  workTitle: string;
  mode: BundleMode;
  stats: {
    chaptersCount: number;
    pagesCount: number;
    framesCount: number;
    scenesCount: number;
    audioCount: number;
  };
}

export interface BundleProgress {
  percentage: number;
  message: string;
}

export type BundleProgressCallback = (progress: BundleProgress) => void;

export interface ExportBundleOptions {
  mode?: BundleMode;
  onProgress?: BundleProgressCallback;
}

export interface ExportBundleResult {
  blob: Blob;
  filename: string;
  manifest: RecapManifest;
}

function inferMimeType(filename: string, fallback = 'application/octet-stream'): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'm4a':
      return 'audio/mp4';
    case 'json':
      return 'application/json';
    default:
      return fallback;
  }
}

function getExtFromMime(mime: string, fallback = 'bin'): string {
  switch (mime) {
    case 'image/webp':
      return 'webp';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    default:
      return fallback;
  }
}

async function resolveBlob(source: Blob | string | undefined): Promise<Blob | undefined> {
  if (!source) return undefined;
  if (source instanceof Blob) return source;
  if (typeof source === 'string') {
    try {
      const res = await fetch(source);
      if (res.ok) {
        return await res.blob();
      }
    } catch (err) {
      console.warn('Erro ao resolver Blob via fetch:', source.substring(0, 40), err);
    }
  }
  return undefined;
}

/**
 * Exports current workspace project state into a portable .recap ZIP bundle
 */
export async function exportProjectBundle(
  state: {
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
  },
  options: ExportBundleOptions = {}
): Promise<ExportBundleResult> {
  const { mode = 'full', onProgress } = options;
  const zip = new JSZip();

  const totalSteps = 4;
  let currentStep = 0;

  const notify = (pct: number, msg: string) => {
    onProgress?.({ percentage: Math.min(100, Math.round(pct)), message: msg });
  };

  notify(5, 'Iniciando empacotamento do projeto...');

  // 1. Collect chapter raw pages if mode === 'full'
  let exportedPagesCount = 0;
  const chapterPageFilenames: Record<string, string[]> = {};

  if (mode === 'full') {
    notify(10, 'Coletando imagens originais dos capítulos...');
    for (let i = 0; i < state.chapters.length; i++) {
      const ch = state.chapters[i];
      chapterPageFilenames[ch.id] = [];

      let blobs: Blob[] = ch.pageBlobs || [];
      if (blobs.length === 0) {
        const storedBlobs = await getChapterMediaBlobs(ch.id);
        if (storedBlobs && storedBlobs.length > 0) {
          blobs = storedBlobs;
        }
      }

      if (blobs.length === 0 && ch.imageUrls && ch.imageUrls.length > 0) {
        for (const url of ch.imageUrls) {
          const b = await resolveBlob(url);
          if (b) blobs.push(b);
        }
      }

      for (let pIdx = 0; pIdx < blobs.length; pIdx++) {
        const pageBlob = blobs[pIdx];
        const ext = getExtFromMime(pageBlob.type, 'jpg');
        const pageFilename = `${String(pIdx + 1).padStart(3, '0')}.${ext}`;
        const assetPath = `assets/chapters/${ch.id}/${pageFilename}`;

        // Store media with STORE compression (no recompression)
        zip.file(assetPath, pageBlob, { compression: 'STORE' });
        chapterPageFilenames[ch.id].push(pageFilename);
        exportedPagesCount++;
      }

      const chapterPct = 10 + Math.round(((i + 1) / state.chapters.length) * 30);
      notify(chapterPct, `Capítulo "${ch.label}" adicionado (${blobs.length} páginas)...`);
    }
  } else {
    notify(30, 'Modo compacto selecionado: pulando páginas brutas...');
  }

  // 2. Collect frame cropped blobs
  notify(45, 'Coletando quadros recortados...');
  const frameFilenames: Record<string, string> = {};
  for (let i = 0; i < state.frames.length; i++) {
    const f = state.frames[i];
    let cropBlob = f.blob;
    if (!cropBlob && f.src) {
      cropBlob = await resolveBlob(f.src);
    }

    if (cropBlob) {
      const ext = getExtFromMime(cropBlob.type, 'webp');
      const filename = `${f.id}.${ext}`;
      const assetPath = `assets/frames/${filename}`;
      zip.file(assetPath, cropBlob, { compression: 'STORE' });
      frameFilenames[f.id] = filename;
    }
  }
  notify(60, `${state.frames.length} quadros recortados incluídos.`);

  // 3. Collect scene audio blobs
  notify(65, 'Coletando narrações em áudio...');
  let exportedAudioCount = 0;
  const sceneAudioFilenames: Record<string, string> = {};
  for (let i = 0; i < state.scenes.length; i++) {
    const s = state.scenes[i];
    let audioBlob = s.audioBlob;
    if (!audioBlob && s.audioUrl) {
      audioBlob = await resolveBlob(s.audioUrl);
    }

    if (audioBlob && audioBlob.size > 0) {
      const ext = getExtFromMime(audioBlob.type, 'mp3');
      const filename = `${s.id}.${ext}`;
      const assetPath = `assets/audio/${filename}`;
      zip.file(assetPath, audioBlob, { compression: 'STORE' });
      sceneAudioFilenames[s.id] = filename;
      exportedAudioCount++;
    }
  }
  notify(75, `${exportedAudioCount} áudios narrados incluídos.`);

  // 4. Construct manifest.json and project.json
  const workTitle = state.projectMetadata?.workTitle || state.title || 'Projeto_Recap';
  const manifest: RecapManifest = {
    formatVersion: 1,
    appVersion: '1.0.0',
    createdAt: Date.now(),
    workTitle,
    mode,
    stats: {
      chaptersCount: state.chapters.length,
      pagesCount: exportedPagesCount,
      framesCount: state.frames.length,
      scenesCount: state.scenes.length,
      audioCount: exportedAudioCount,
    },
  };

  const projectPayload = {
    version: 1,
    updatedAt: Date.now(),
    title: workTitle,
    currentChapterId: state.currentChapterId,
    currentPageNumber: state.currentPageNumber,
    currentTab: state.currentTab,
    chapters: state.chapters.map((ch) => ({
      id: ch.id,
      label: ch.label,
      pages: mode === 'full' ? (chapterPageFilenames[ch.id]?.length ?? ch.pages) : ch.pages,
      done: ch.done || 0,
      pageFiles: chapterPageFilenames[ch.id] || [],
    })),
    frames: state.frames.map((f) => ({
      id: f.id,
      label: f.label,
      ratio: f.ratio,
      duration: f.duration,
      chapterId: f.chapterId,
      pageNumber: f.pageNumber,
      transition: f.transition,
      narrationSnippet: f.narrationSnippet,
      panelId: f.panelId,
      cropRect: f.cropRect,
      filename: frameFilenames[f.id],
    })),
    scenes: state.scenes.map((s) => ({
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
      extractedContext: s.extractedContext,
      appliedStyleId: s.appliedStyleId,
      audioFilename: sceneAudioFilenames[s.id],
    })),
    chapterPanels: state.chapterPanels || {},
    projectMetadata: state.projectMetadata,
    chapterMetadata: state.chapterMetadata || {},
    pageScripts: state.pageScripts || {},
    globalConfig: state.globalConfig || {},
  };

  // Add JSON files with DEFLATE compression
  zip.file('manifest.json', JSON.stringify(manifest, null, 2), {
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  zip.file('project.json', JSON.stringify(projectPayload, null, 2), {
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  notify(85, 'Compactando arquivo .recap final...');

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      mimeType: 'application/octet-stream',
    },
    (metadata) => {
      const pct = 85 + Math.round((metadata.percent / 100) * 14);
      notify(pct, `Gerando .recap: ${Math.round(metadata.percent)}%...`);
    }
  );

  notify(100, 'Projeto empacotado com sucesso!');

  const sanitizedTitle = workTitle.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 40) || 'Projeto_Recap';
  const dateStr = new Date().toISOString().slice(0, 10);
  const suffix = mode === 'compact' ? '_compact' : '';
  const filename = `${sanitizedTitle}_${dateStr}${suffix}.recap`;

  return {
    blob: zipBlob,
    filename,
    manifest,
  };
}

/**
 * Imports and unpacks a .recap ZIP bundle file, restoring all media Blobs with correct MIME types
 */
export async function importProjectBundle(
  file: File | Blob,
  onProgress?: BundleProgressCallback
): Promise<{ state: HydratedProjectState; manifest: RecapManifest }> {
  const notify = (pct: number, msg: string) => {
    onProgress?.({ percentage: Math.min(100, Math.round(pct)), message: msg });
  };

  notify(5, 'Lendo arquivo .recap...');
  const zip = await JSZip.loadAsync(file);

  // Helper to find file in zip even if nested in a root folder or with different separators
  function findZipFile(name: string) {
    let f = zip.file(name);
    if (!f) {
      const lower = name.toLowerCase();
      for (const [key, obj] of Object.entries(zip.files)) {
        if (!obj.dir) {
          const cleanKey = key.replace(/\\/g, '/').toLowerCase();
          if (cleanKey === lower || cleanKey.endsWith('/' + lower)) {
            f = obj;
            break;
          }
        }
      }
    }
    return f;
  }

  // 1. Read manifest.json
  const manifestFile = findZipFile('manifest.json');
  if (!manifestFile) {
    throw new Error('Arquivo de projeto inválido: manifest.json não encontrado.');
  }
  const manifestText = await manifestFile.async('text');
  const manifest: RecapManifest = JSON.parse(manifestText);

  // 2. Read project.json
  const projectFile = findZipFile('project.json');
  if (!projectFile) {
    throw new Error('Arquivo de projeto inválido: project.json não encontrado.');
  }
  const projectText = await projectFile.async('text');
  const projectData = JSON.parse(projectText);

  notify(15, 'Estrutura do projeto validada. Extraindo mídias...');

  // Helper to extract file as ArrayBuffer and construct a Blob with explicit MIME
  async function extractBlob(filePath: string): Promise<Blob | null> {
    const entry = findZipFile(filePath);
    if (!entry) return null;
    const buffer = await entry.async('arraybuffer');
    const mime = inferMimeType(filePath);
    return new Blob([buffer], { type: mime });
  }

  // 3. Extract Frames
  const frameMap = new Map<string, FrameItem>();
  const hydratedFrames: FrameItem[] = [];
  const rawFrames = projectData.frames || [];

  for (let i = 0; i < rawFrames.length; i++) {
    const rf = rawFrames[i];
    let cropBlob: Blob | null = null;

    if (rf.filename) {
      cropBlob = await extractBlob(`assets/frames/${rf.filename}`);
    } else {
      // Fallback: try default pattern
      cropBlob =
        (await extractBlob(`assets/frames/${rf.id}.webp`)) ||
        (await extractBlob(`assets/frames/${rf.id}.png`)) ||
        (await extractBlob(`assets/frames/${rf.id}.jpg`));
    }

    const src = cropBlob
      ? registerCreatedUrl(URL.createObjectURL(cropBlob))
      : '';

    const frame: FrameItem = {
      id: rf.id,
      label: rf.label,
      src,
      ratio: rf.ratio || '16:9',
      duration: rf.duration || 3.5,
      chapterId: rf.chapterId,
      pageNumber: rf.pageNumber,
      transition: rf.transition,
      narrationSnippet: rf.narrationSnippet,
      panelId: rf.panelId,
      cropRect: rf.cropRect,
      blob: cropBlob || undefined,
    };

    frameMap.set(frame.id, frame);
    hydratedFrames.push(frame);

    if (i % 5 === 0) {
      const pct = 15 + Math.round(((i + 1) / Math.max(1, rawFrames.length)) * 25);
      notify(pct, `Restaurando quadros recortados (${i + 1}/${rawFrames.length})...`);
    }
  }

  // 4. Extract Chapters
  const hydratedChapters: ChapterItem[] = [];
  const rawChapters = projectData.chapters || [];

  for (let cIdx = 0; cIdx < rawChapters.length; cIdx++) {
    const rc = rawChapters[cIdx];
    const pageBlobs: Blob[] = [];
    const pageFiles: string[] = rc.pageFiles || [];

    if (pageFiles.length > 0) {
      for (const pFile of pageFiles) {
        const blob = await extractBlob(`assets/chapters/${rc.id}/${pFile}`);
        if (blob) {
          pageBlobs.push(blob);
        }
      }
    } else {
      // Fallback: search zip folder for this chapter
      const chapterFolder = zip.folder(`assets/chapters/${rc.id}`);
      if (chapterFolder) {
        const fileNames: string[] = [];
        chapterFolder.forEach((relPath, f) => {
          if (!f.dir) fileNames.push(relPath);
        });
        fileNames.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        for (const fname of fileNames) {
          const blob = await extractBlob(`assets/chapters/${rc.id}/${fname}`);
          if (blob) pageBlobs.push(blob);
        }
      }
    }

    const imageUrls = pageBlobs.map((blob) => registerCreatedUrl(URL.createObjectURL(blob)));

    hydratedChapters.push({
      id: rc.id,
      label: rc.label,
      pages: pageBlobs.length > 0 ? pageBlobs.length : rc.pages || 0,
      done: rc.done || 0,
      imageUrls,
      pageBlobs,
    });

    const pct = 40 + Math.round(((cIdx + 1) / Math.max(1, rawChapters.length)) * 30);
    notify(pct, `Restaurando capítulo "${rc.label}" (${pageBlobs.length} páginas)...`);
  }

  // 5. Extract Scenes & Audios
  const hydratedScenes: SceneItem[] = [];
  const rawScenes = projectData.scenes || [];

  for (let sIdx = 0; sIdx < rawScenes.length; sIdx++) {
    const rs = rawScenes[sIdx];
    let audioBlob: Blob | undefined = undefined;

    if (rs.audioFilename) {
      const b = await extractBlob(`assets/audio/${rs.audioFilename}`);
      if (b) audioBlob = b;
    } else {
      const b =
        (await extractBlob(`assets/audio/${rs.id}.mp3`)) ||
        (await extractBlob(`assets/audio/${rs.id}.wav`)) ||
        (await extractBlob(`assets/audio/${rs.id}.webm`));
      if (b) audioBlob = b;
    }

    let audioUrl: string | undefined = undefined;
    if (audioBlob && audioBlob.size > 0) {
      audioUrl = registerCreatedUrl(URL.createObjectURL(audioBlob));
    }

    const matchedFrames = (rs.frameIds || [])
      .map((fId: string) => frameMap.get(fId))
      .filter((f: FrameItem | undefined): f is FrameItem => Boolean(f));

    hydratedScenes.push({
      id: rs.id,
      title: rs.title,
      frames: matchedFrames,
      voice: rs.voice || 'pt-BR-Neural2-B',
      duration: rs.duration || '0:03',
      text: rs.text || '',
      chapterId: rs.chapterId,
      pageNumber: rs.pageNumber,
      status: rs.status || 'idle',
      audioUrl,
      audioBlob,
      audioDuration: rs.audioDuration,
      audioModel: rs.audioModel,
      extractedContext: rs.extractedContext,
      appliedStyleId: rs.appliedStyleId,
    });

    if (sIdx % 3 === 0) {
      const pct = 70 + Math.round(((sIdx + 1) / Math.max(1, rawScenes.length)) * 25);
      notify(pct, `Restaurando narrações e cenas (${sIdx + 1}/${rawScenes.length})...`);
    }
  }

  notify(95, 'Finalizando reconstrução do projeto...');

  // Safe tab determination: if mode === 'compact' and no chapter page images exist, default to 'roteiro' or 'montagem'
  let targetTab: StudioTab = projectData.currentTab || 'recorte';
  const hasRawPages = hydratedChapters.some((ch) => ch.pageBlobs && ch.pageBlobs.length > 0);
  if (!hasRawPages && targetTab === 'recorte') {
    targetTab = hydratedScenes.length > 0 ? 'montagem' : 'roteiro';
  }

  const hydratedState: HydratedProjectState = {
    chapters: hydratedChapters,
    frames: hydratedFrames,
    scenes: hydratedScenes,
    chapterPanels: projectData.chapterPanels || {},
    currentChapterId: projectData.currentChapterId || hydratedChapters[0]?.id || '',
    currentPageNumber: projectData.currentPageNumber || 1,
    currentTab: targetTab,
    title: projectData.title || manifest.workTitle || 'Projeto Manhwa Recap',
    projectMetadata: {
      workTitle: projectData.projectMetadata?.workTitle || manifest.workTitle || '',
      universeLore: projectData.projectMetadata?.universeLore || '',
      glossary: projectData.projectMetadata?.glossary || {},
      characters: projectData.projectMetadata?.characters || [],
      narrativeHistory: projectData.projectMetadata?.narrativeHistory || [],
    },
    chapterMetadata: projectData.chapterMetadata || {},
    pageScripts: projectData.pageScripts || {},
    updatedAt: Date.now(),
  };

  notify(100, 'Projeto restaurado com sucesso!');

  return {
    state: hydratedState,
    manifest,
  };
}

/**
 * Triggers a native browser file download for a given Blob
 */
export function triggerBundleDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);
}
