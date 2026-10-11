import { get, set, del } from 'idb-keyval';

const THUMB_KEY_PREFIX = 'recap_thumb_v2_';

// In-memory cache for instantaneous synchronous lookups
const inMemoryCache = new Map<string, Record<number, string>>();

// Track in-progress generation per chapter to avoid duplicate concurrent jobs
const activeJobs = new Set<string>();

/**
 * Creates an ultra-lightweight proxy thumbnail (80x128px JPEG, ~2.5 KB)
 * from a raw high-resolution image URL.
 * Takes the top aspect-ratio cover portion of tall webtoon strips.
 */
export function createProxyThumbnail(
  sourceUrl: string,
  targetWidth = 80,
  targetHeight = 128,
  quality = 0.65
): Promise<string> {
  return new Promise((resolve) => {
    if (!sourceUrl) {
      resolve('');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    let resolved = false;
    const finish = (result: string) => {
      if (!resolved) {
        resolved = true;
        img.onload = null;
        img.onerror = null;
        resolve(result);
      }
    };

    // Safety timeout in case an image fails to load
    const timer = setTimeout(() => finish(''), 4000);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish('');
          return;
        }

        const natW = img.naturalWidth || 800;
        const natH = img.naturalHeight || 1280;

        // Cover the top portion corresponding to the thumbnail's aspect ratio
        const srcH = Math.min(natH, Math.round(natW * (targetHeight / targetWidth)));
        ctx.drawImage(img, 0, 0, natW, srcH, 0, 0, targetWidth, targetHeight);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        finish(dataUrl);
      } catch (err) {
        finish('');
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      finish('');
    };

    img.src = sourceUrl;
  });
}

/**
 * Retrieves cached thumbnails for a chapter (memory first, then IndexedDB)
 */
export async function getChapterThumbnails(chapterId: string): Promise<Record<number, string> | undefined> {
  if (!chapterId) return undefined;

  if (inMemoryCache.has(chapterId)) {
    return inMemoryCache.get(chapterId);
  }

  try {
    const stored = await get<Record<number, string>>(`${THUMB_KEY_PREFIX}${chapterId}`);
    if (stored && Object.keys(stored).length > 0) {
      inMemoryCache.set(chapterId, stored);
      return stored;
    }
  } catch (err) {
    console.warn(`[Thumbnails] Erro ao ler miniaturas do capítulo ${chapterId}:`, err);
  }

  return undefined;
}

/**
 * Saves thumbnails for a chapter into both memory and IndexedDB
 */
export async function saveChapterThumbnails(
  chapterId: string,
  thumbnails: Record<number, string>
): Promise<void> {
  if (!chapterId) return;
  inMemoryCache.set(chapterId, thumbnails);
  try {
    await set(`${THUMB_KEY_PREFIX}${chapterId}`, thumbnails);
  } catch (err) {
    console.warn(`[Thumbnails] Erro ao salvar miniaturas do capítulo ${chapterId}:`, err);
  }
}

/**
 * Deletes thumbnail cache for a chapter
 */
export async function deleteChapterThumbnails(chapterId: string): Promise<void> {
  if (!chapterId) return;
  inMemoryCache.delete(chapterId);
  try {
    await del(`${THUMB_KEY_PREFIX}${chapterId}`);
  } catch {}
}

/**
 * Generates low-resolution thumbnails progressively one by one in the background.
 * Yields execution back to the browser between pages to guarantee 0% UI lag.
 */
export async function generateChapterThumbnailsSequentially(
  chapterId: string,
  imageUrls: string[],
  onProgress?: (pageNum: number, thumbUrl: string) => void
): Promise<Record<number, string>> {
  if (!chapterId || imageUrls.length === 0) return {};

  // If already generating for this chapter, don't run duplicate parallel pipeline
  if (activeJobs.has(chapterId)) {
    const existing = inMemoryCache.get(chapterId);
    if (existing) return existing;
  }

  activeJobs.add(chapterId);

  try {
    const existing = (await getChapterThumbnails(chapterId)) || {};
    const result: Record<number, string> = { ...existing };

    for (let idx = 0; idx < imageUrls.length; idx++) {
      const pageNum = idx + 1;
      const url = imageUrls[idx];

      // If already generated, notify and continue
      if (result[pageNum]) {
        if (onProgress) onProgress(pageNum, result[pageNum]);
        continue;
      }

      if (!url) continue;

      // Generate single proxy thumbnail
      const thumb = await createProxyThumbnail(url, 80, 128, 0.65);
      if (thumb) {
        result[pageNum] = thumb;
        if (onProgress) onProgress(pageNum, thumb);
      }

      // Crucial: 12ms yield to the event loop so the UI, animations and scrolling stay 60 FPS
      await new Promise((resolve) => setTimeout(resolve, 12));
    }

    await saveChapterThumbnails(chapterId, result);
    return result;
  } finally {
    activeJobs.delete(chapterId);
  }
}
