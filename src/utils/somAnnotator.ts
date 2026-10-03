import { FrameItem } from '../types';

export interface SoMPaletteItem {
  border: string;
  bg: string;
  text: string;
  name: string;
}

/**
 * High-contrast fluorescent palette for Set-of-Mark (SoM) bounding boxes & tags
 */
export const SOM_PALETTE: SoMPaletteItem[] = [
  { border: '#00FF66', bg: '#00FF66', text: '#000000', name: 'Neon Green' },
  { border: '#FFE600', bg: '#FFE600', text: '#000000', name: 'Fluorescent Yellow' },
  { border: '#00F0FF', bg: '#00F0FF', text: '#000000', name: 'Electric Cyan' },
  { border: '#FF0077', bg: '#FF0077', text: '#FFFFFF', name: 'Vivid Magenta' },
  { border: '#FF6600', bg: '#FF6600', text: '#FFFFFF', name: 'Blaze Orange' },
  { border: '#9933FF', bg: '#9933FF', text: '#FFFFFF', name: 'Bright Violet' },
];

export interface SoMAnnotationOptions {
  rawImageUrl: string;
  frames: FrameItem[];
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

/**
 * Loads an image from a URL, blob URL, or data URI
 */
function loadImageAsync(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Falha ao carregar imagem para anotação SoM.'));
    img.src = src;
  });
}

/**
 * Renders an offscreen canvas containing the raw page image overlaid with
 * high-contrast Set-of-Mark (SoM) bounding boxes and prominent tag badges
 * (e.g. "[Quadro 01]", "[Quadro 02]") corresponding to the user's cropped frames.
 *
 * Returns an optimized Base64 JPEG data URL for multimodal vision LLM endpoints.
 */
export async function generateSoMAnnotatedPage({
  rawImageUrl,
  frames,
  maxWidth = 1200,
  maxHeight = 2000,
  quality = 0.82,
}: SoMAnnotationOptions): Promise<string> {
  if (!rawImageUrl) {
    throw new Error('URL da imagem não fornecida para anotação SoM.');
  }

  const img = await loadImageAsync(rawImageUrl);
  const origW = img.naturalWidth || img.width || 800;
  const origH = img.naturalHeight || img.height || 1200;

  // Scale down if image exceeds maximum dimensions, preserving aspect ratio
  const scale = Math.min(1.0, maxWidth / origW, maxHeight / origH);
  const canvasW = Math.round(origW * scale);
  const canvasH = Math.round(origH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Falha ao obter contexto 2D para anotação SoM.');
  }

  // 1. Draw solid background to prevent transparency artifacts
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. Draw raw page image
  ctx.drawImage(img, 0, 0, canvasW, canvasH);

  // If no frames, return plain optimized image
  if (!frames || frames.length === 0) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  // 3. Draw Set-of-Mark (SoM) Bounding Boxes and Badges
  frames.forEach((frame, idx) => {
    const color = SOM_PALETTE[idx % SOM_PALETTE.length];

    // Determine bounding box coordinates scaled to canvas
    let boxX = 0;
    let boxY = 0;
    let boxW = 0;
    let boxH = 0;

    if (frame.cropRect && frame.cropRect.width > 0 && frame.cropRect.height > 0) {
      boxX = Math.round(frame.cropRect.x * scale);
      boxY = Math.round(frame.cropRect.y * scale);
      boxW = Math.round(frame.cropRect.width * scale);
      boxH = Math.round(frame.cropRect.height * scale);
    } else {
      // Fallback: estimate proportional vertical slice if cropRect is absent
      const count = frames.length;
      const sliceH = Math.round(canvasH / count);
      boxX = Math.round(canvasW * 0.04);
      boxY = Math.round(idx * sliceH + canvasH * 0.015);
      boxW = Math.round(canvasW * 0.92);
      boxH = Math.max(40, sliceH - Math.round(canvasH * 0.03));
    }

    // Clamp inside canvas bounds
    boxX = Math.max(0, Math.min(canvasW - 10, boxX));
    boxY = Math.max(0, Math.min(canvasH - 10, boxY));
    boxW = Math.min(canvasW - boxX, Math.max(20, boxW));
    boxH = Math.min(canvasH - boxY, Math.max(20, boxH));

    const strokeWidth = Math.max(5, Math.min(10, Math.round(canvasW * 0.006)));

    // Outer dark outline for maximum contrast against light or dark manga backgrounds
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.lineWidth = strokeWidth + 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // High-contrast neon colored inner stroke
    ctx.strokeStyle = color.border;
    ctx.lineWidth = strokeWidth;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.restore();

    // 4. Draw Tag Badge (e.g. "[Quadro 01]", "[Quadro 02]")
    const labelRaw = frame.label?.trim() || `Quadro ${String(idx + 1).padStart(2, '0')}`;
    const badgeText = labelRaw.startsWith('[') && labelRaw.endsWith(']') ? labelRaw : `[${labelRaw}]`;

    ctx.save();
    const fontSize = Math.max(16, Math.min(26, Math.round(canvasW * 0.024)));
    ctx.font = `bold ${fontSize}px "Segoe UI", -apple-system, Roboto, sans-serif`;
    ctx.textBaseline = 'middle';

    const textMetrics = ctx.measureText(badgeText);
    const textWidth = textMetrics.width;
    const paddingX = Math.round(fontSize * 0.55);
    const badgeWidth = textWidth + paddingX * 2;
    const badgeHeight = Math.round(fontSize * 1.65);

    // Place badge at top-left of the bounding box
    let badgeX = boxX;
    let badgeY = boxY - badgeHeight;

    // If box is near the top edge, render badge just inside the box
    if (badgeY < 2) {
      badgeY = boxY + strokeWidth + 2;
    }

    // Ensure badge does not overflow canvas right edge
    if (badgeX + badgeWidth > canvasW) {
      badgeX = canvasW - badgeWidth - 2;
    }

    // Outer dark pill shadow for badge
    ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
    if (typeof (ctx as any).roundRect === 'function') {
      (ctx as any).roundRect(badgeX - 2, badgeY - 2, badgeWidth + 4, badgeHeight + 4, 6);
      ctx.fill();
    } else {
      ctx.fillRect(badgeX - 2, badgeY - 2, badgeWidth + 4, badgeHeight + 4);
    }

    // Badge solid colored background
    ctx.fillStyle = color.bg;
    if (typeof (ctx as any).roundRect === 'function') {
      ctx.beginPath();
      (ctx as any).roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 5);
      ctx.fill();
    } else {
      ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);
    }

    // Badge text
    ctx.fillStyle = color.text;
    ctx.fillText(badgeText, badgeX + paddingX, badgeY + badgeHeight / 2);
    ctx.restore();
  });

  return canvas.toDataURL('image/jpeg', quality);
}
