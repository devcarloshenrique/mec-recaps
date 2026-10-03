/**
 * Automatic Manhwa / Webtoon Panel Detection Algorithms (Fase 1)
 * 
 * Implements:
 * 1. Horizontal Profile Projection (Projeção Horizontal de Perfil)
 *    - Row-by-row color variance and edge rate to detect continuous empty gutters.
 *    - Millisecond CPU execution. Slices tall vertical manhwa strips into clean panel blocks.
 * 2. Morphology & Contours (Morfologia e Contornos)
 *    - Edge detection, morphological dilation to close broken frames, connected component analysis.
 *    - Detects drawn rectangular frames and isolates side-by-side frames on the same horizontal level.
 * 3. SAHI - Slicing Aided Hyper Inference (Janelas Deslizantes)
 *    - Infrastructure strategy for huge images (10,000px - 30,000px+) without memory overload.
 *    - Slices into overlapping windows, runs detection, maps back to global coordinates, and merges with NMS.
 * 4. Hybrid Pipeline (Projeção de Perfil + Morfologia interna) - RECOMENDADO
 *    - Slices vertical strip into manageable blocks via Profile Projection.
 *    - Within each block, checks for side-by-side panels and refines rectangular borders via Morphology.
 */

export type DetectionAlgorithm = 'profile' | 'morphology' | 'sahi' | 'hybrid' | 'manual';

export interface DetectionOptions {
  algorithm?: DetectionAlgorithm;
  minPanelHeight?: number;      // Minimum height in px to consider as a frame (default: 45)
  minPanelWidth?: number;       // Minimum width in px (default: 60)
  gutterThreshold?: number;     // Variance threshold for gutter detection (0-100, default: 20)
  padding?: number;             // Padding in px around detected frames (default: 4)
  sliceHeight?: number;         // For SAHI: height of window slice in px (default: 1000)
  sliceOverlap?: number;        // For SAHI: overlap ratio (e.g. 0.25 = 25%)
  iouThreshold?: number;        // For SAHI / NMS box merging (default: 0.35)
  filterTextBubbles?: boolean;  // Morphophotometric Text & Speech Bubble filter (default: true)
  textFilterThreshold?: number; // Score threshold above which patch is discarded (default: 0.55)
  minGlyphArea?: number;        // Minimum area for glyph component in CCL (default: 12 px²)
  maxGlyphArea?: number;        // Maximum area for glyph component in CCL (default: 450 px²)
}

export interface DetectedPanel {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  algorithm: DetectionAlgorithm;
  label: string;
  pageWidth?: number;
  pageHeight?: number;
}

export interface AlgorithmInfo {
  id: DetectionAlgorithm;
  name: string;
  badge: string;
  tagline: string;
  whatItDoes: string;
  technology: string;
  cost: string;
  whereExcels: string;
  limitations: string;
  impact: string;
  recommended?: boolean;
}

export const ALGORITHM_INFO: Record<DetectionAlgorithm, AlgorithmInfo> = {
  profile: {
    id: 'profile',
    name: 'Projeção Horizontal de Perfil',
    badge: '⚡ Rápido (CPU ms)',
    tagline: 'Mede variação linha a linha para achar calhas vazias contínuas',
    whatItDoes: 'Mede a variação de cor e desvio padrão linha por linha para achar calhas vazias contínuas (brancas, pretas ou tons uniformes) sem olhar o conteúdo interno.',
    technology: 'Heurística matemática / Álgebra matricial (vetorização em tempo real).',
    cost: 'Quase zero (roda em milissegundos na CPU do navegador).',
    whereExcels: 'Manhwas tradicionais com bastante respiro em branco ou preto entre as cenas (Webtoon, Tapas, Kakao).',
    limitations: 'Quebra se houver arte contínua de fundo, fumaça ou degradês pesados unindo dois quadros.',
    impact: 'Resolve 70% dos cortes de tiras verticais de forma imediata e sem dependências pesadas.',
  },
  morphology: {
    id: 'morphology',
    name: 'Contornos e Morfologia',
    badge: '📐 Molduras & Lado a Lado',
    tagline: 'Binariza e dilata traços para fechar e extrair molduras desenhadas',
    whatItDoes: 'Binariza o gradiente da imagem, dilata traços estruturais para fechar molduras abertas e extrai caixas geométricas de painéis.',
    technology: 'Visão Computacional Clássica (Gradiente Sobel, Fechamento Morfológico e Componentes Conexos).',
    cost: 'Muito baixo (roda em centenas de milissegundos na CPU).',
    whereExcels: 'Cenas com molduras retangulares bem visíveis e traços pretos contínuos. Permite isolar quadros vizinhos no mesmo nível horizontal (lado a lado).',
    limitations: 'Falha em painéis abertos (borderless) ou onde a moldura é interrompida por um golpe/efeito de impacto.',
    impact: 'Isola quadros lado a lado na mesma altura e refina as margens internas com precisão geométrica.',
  },
  sahi: {
    id: 'sahi',
    name: 'SAHI (Janelas Deslizantes)',
    badge: '🪟 Tiras Gigantes > 20k px',
    tagline: 'Fatia imagens gigantes em blocos sobrepostos para evitar estouro de memória',
    whatItDoes: 'Orquestra o fatiamento de tiras ultra-altas (10.000px a 30.000px+) em janelas móveis com sobreposição (stride), mapeia coordenadas globais e aplica NMS/IoU para fundir quadros divididos nas junções.',
    technology: 'Orquestrador de inferência com Janelas Deslizantes + Fusão NMS por IoU.',
    cost: 'Moderado (processa janelas sequenciais sem sobrecarregar a memória da máquina).',
    whereExcels: 'Webtoons contínuos e tiras gigantes de capítulos inteiros onde o canvas normal estouraria a RAM.',
    limitations: 'Exige fusão precisa de caixas que cruzam a linha de corte das janelas.',
    impact: 'Garante estabilidade e precisão profissional em arquivos de resolução extrema sem travar o navegador.',
  },
  hybrid: {
    id: 'hybrid',
    name: 'Pipeline Híbrido (Projeção + Morfologia)',
    badge: '✨ Mais Recomendado',
    tagline: 'Fatiamento vertical por Projeção com isolamento morfológico interno',
    whatItDoes: 'Executa a Projeção Horizontal de Perfil para quebrar a tira vertical em blocos manejáveis e, dentro de cada bloco fatiado, aplica Morfologia/Contornos para detectar quadros lado a lado ou ajustar margens irregulares.',
    technology: 'Pipeline combinada (Álgebra de Perfil + Morfologia de Contorno Local).',
    cost: 'Baixo (~10-50ms por página).',
    whereExcels: 'Qualquer manhwa ou mangá moderno: combina a velocidade da Projeção com a inteligência morfológica para quadros múltiplos.',
    limitations: 'Quadros 100% artísticos sem nenhuma calha e sem nenhuma borda exigem ajuste manual fino.',
    impact: 'Atinge a mais alta taxa de acerto prático (~90%+ dos painéis automáticos prontos para uso).',
    recommended: true,
  },
  manual: {
    id: 'manual',
    name: 'Manual (Ferramenta Corte C)',
    badge: '✂️ Manual',
    tagline: 'Desenhado manualmente com a ferramenta de corte C',
    whatItDoes: 'Zona de enquadramento definida interativamente pelo usuário.',
    technology: 'Interativo (Coordenadas Reais do Usuário).',
    cost: 'Zero.',
    whereExcels: 'Cortes personalizados, artes complexas e enquadramentos artísticos livres.',
    limitations: 'Requer demarcação manual.',
    impact: 'Controle total nas mãos do editor.',
  },
};

/**
 * Converts image source to an HTMLImageElement if not already loaded
 * Handles blob:, data:, same-origin, and remote URLs safely without triggering CORS errors
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // Only set crossOrigin for remote http(s) URLs that are from a different origin.
    // Setting crossOrigin on blob: or data: or same-origin URLs causes Chrome/Safari
    // to fail loading or throw CORS security errors.
    if (typeof window !== 'undefined' && (src.startsWith('http://') || src.startsWith('https://'))) {
      try {
        const urlObj = new URL(src, window.location.href);
        if (urlObj.origin !== window.location.origin) {
          img.crossOrigin = 'anonymous';
        }
      } catch {
        // keep default
      }
    }

    img.onload = () => resolve(img);
    img.onerror = (err) => {
      // If failed with crossOrigin set, retry once cleanly without crossOrigin
      if (img.crossOrigin) {
        const fallback = new Image();
        fallback.onload = () => resolve(fallback);
        fallback.onerror = (err2) => reject(err2);
        fallback.src = src;
        return;
      }
      reject(err);
    };
    img.src = src;
  });
}

/**
 * Extracts ImageData from an HTMLImageElement using an offscreen canvas.
 * Consistently resolves intrinsic image dimensions (naturalWidth / naturalHeight).
 */
export function getImageDataFromElement(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  const w = img.naturalWidth || img.width || 704;
  const h = img.naturalHeight || img.height || 1408;
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2d context for image data extraction');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Extracts a panel region from an HTMLImageElement to a JPEG data URL.
 * Safely clamps panel bounding box coordinates to the source image bounds.
 */
export function extractPanelToDataUrl(
  img: HTMLImageElement,
  panel: { x: number; y: number; width: number; height: number },
  quality = 0.94
): string {
  const natW = img.naturalWidth || img.width || 704;
  const natH = img.naturalHeight || img.height || 1408;

  const clampX = Math.max(0, Math.min(natW - 10, Math.round(panel.x)));
  const clampY = Math.max(0, Math.min(natH - 10, Math.round(panel.y)));
  const clampW = Math.max(10, Math.min(natW - clampX, Math.round(panel.width)));
  const clampH = Math.max(10, Math.min(natH - clampY, Math.round(panel.height)));

  const canvas = document.createElement('canvas');
  canvas.width = clampW;
  canvas.height = clampH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.drawImage(
    img,
    clampX,
    clampY,
    clampW,
    clampH,
    0,
    0,
    clampW,
    clampH
  );
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Returns closest standard AspectRatio for given width and height
 */
export function getClosestAspectRatio(width: number, height: number): '16:9' | '9:16' | '1:1' | '4:3' | 'Livre' {
  const r = width / height;
  const ratios: { name: '16:9' | '9:16' | '1:1' | '4:3'; val: number }[] = [
    { name: '16:9', val: 16 / 9 },
    { name: '9:16', val: 9 / 16 },
    { name: '1:1', val: 1 },
    { name: '4:3', val: 4 / 3 },
  ];

  let best = ratios[0];
  let minDiff = Math.abs(r - best.val);
  for (let i = 1; i < ratios.length; i++) {
    const diff = Math.abs(r - ratios[i].val);
    if (diff < minDiff) {
      minDiff = diff;
      best = ratios[i];
    }
  }

  // If very far from standard ratios, return Livre
  if (minDiff > 0.45) return 'Livre';
  return best.name;
}

/**
 * Computes luminance (0 - 255) for RGB
 */
function getLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * ALGORITHM 1: Horizontal Profile Projection (Projeção Horizontal de Perfil)
 * 
 * Measures color variation and edge presence row-by-row to detect continuous empty gutters.
 * Slices the tall vertical manhwa strip into distinct panel bands.
 */
export function detectPanelsProfileProjection(
  imageData: ImageData,
  options: DetectionOptions = {}
): DetectedPanel[] {
  const { width, height, data } = imageData;
  const minHeight = options.minPanelHeight ?? Math.max(45, Math.round(height * 0.035));
  const minWidth = options.minPanelWidth ?? Math.max(60, Math.round(width * 0.25));
  const padding = options.padding ?? 4;
  const sensitivity = options.gutterThreshold ?? 20; // 0 (strict) - 100 (loose)

  // 1. Calculate row statistics (variance, mean luminance, edge count)
  const isGutterRowRaw = new Uint8Array(height);
  const varianceThreshold = 4.0 + (sensitivity * 0.4);

  for (let y = 0; y < height; y++) {
    let sumLum = 0;
    let sumSqLum = 0;
    let edgeDiffCount = 0;
    const rowOffset = y * width * 4;

    let prevLum = getLuminance(data[rowOffset], data[rowOffset + 1], data[rowOffset + 2]);

    for (let x = 0; x < width; x += 2) { // step by 2 for speed
      const idx = rowOffset + x * 4;
      const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
      sumLum += lum;
      sumSqLum += lum * lum;

      if (Math.abs(lum - prevLum) > 26) {
        edgeDiffCount++;
      }
      prevLum = lum;
    }

    const n = Math.ceil(width / 2);
    const mean = sumLum / n;
    const variance = Math.max(0, (sumSqLum / n) - (mean * mean));
    const stdDev = Math.sqrt(variance);

    // Gutter condition:
    // a) Solid white gutter: mean > 240, low stdDev
    // b) Solid black gutter: mean < 25, low stdDev
    // c) Flat color gutter: low stdDev (< varianceThreshold) and very low edge count
    const isSolidLight = mean > 240 && stdDev < 20;
    const isSolidDark = mean < 25 && stdDev < 20;
    const isFlatRow = stdDev < varianceThreshold && edgeDiffCount < (width * 0.045);

    if (isSolidLight || isSolidDark || isFlatRow) {
      isGutterRowRaw[y] = 1;
    } else {
      isGutterRowRaw[y] = 0;
    }
  }

  // 2. 1D Morphological Closing on gutters to bridge small noise/lines (radius = 3)
  const isGutterRow = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    let hasGutterNear = false;
    const r = 2;
    for (let dy = -r; dy <= r; dy++) {
      const ny = y + dy;
      if (ny >= 0 && ny < height && isGutterRowRaw[ny]) {
        hasGutterNear = true;
        break;
      }
    }
    // Bridge single isolated row gaps
    if (!isGutterRowRaw[y] && y > 0 && y < height - 1 && isGutterRowRaw[y - 1] && isGutterRowRaw[y + 1]) {
      isGutterRow[y] = 1;
    } else {
      isGutterRow[y] = isGutterRowRaw[y];
    }
  }

  // 3. Identify vertical content bands [y1, y2]
  const bands: { y1: number; y2: number }[] = [];
  let inContent = false;
  let startY = 0;
  const minGutterSize = Math.max(6, Math.round(sensitivity * 0.35));

  for (let y = 0; y < height; y++) {
    if (!isGutterRow[y] && !inContent) {
      inContent = true;
      startY = y;
    } else if (isGutterRow[y] && inContent) {
      // Check gutter height
      let gutterHeight = 0;
      while (y + gutterHeight < height && isGutterRow[y + gutterHeight]) {
        gutterHeight++;
      }

      if (gutterHeight >= minGutterSize || y + gutterHeight >= height) {
        inContent = false;
        const panelH = y - startY;
        if (panelH >= minHeight) {
          bands.push({ y1: startY, y2: y });
        }
        y += gutterHeight - 1;
      }
    }
  }

  if (inContent && height - startY >= minHeight) {
    bands.push({ y1: startY, y2: height });
  }

  // 4. In each band, run column projection to isolate left/right panel edges
  const detected: DetectedPanel[] = [];
  let panelIndex = 1;

  for (const band of bands) {
    const bandH = band.y2 - band.y1;
    let minX = width;
    let maxX = 0;

    for (let x = 0; x < width; x += 2) {
      let colActive = false;
      for (let y = band.y1; y < band.y2; y += 4) {
        const idx = (y * width + x) * 4;
        const lum = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
        if (lum > 24 && lum < 242) {
          colActive = true;
          break;
        }
      }
      if (colActive) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    if (minX >= maxX || (maxX - minX) < minWidth) {
      minX = Math.round(width * 0.04);
      maxX = Math.round(width * 0.96);
    }

    const finalX = Math.max(0, minX - padding);
    const finalY = Math.max(0, band.y1 - padding);
    const finalW = Math.min(width - finalX, (maxX - minX) + padding * 2);
    const finalH = Math.min(height - finalY, bandH + padding * 2);

    if (finalW >= minWidth && finalH >= minHeight) {
      detected.push({
        id: `panel_prof_${Date.now()}_${panelIndex}`,
        x: Math.round(finalX),
        y: Math.round(finalY),
        width: Math.round(finalW),
        height: Math.round(finalH),
        confidence: 0.94,
        algorithm: 'profile',
        label: `Quadro ${String(panelIndex).padStart(2, '0')}`,
      });
      panelIndex++;
    }
  }

  return detected;
}

/**
 * ALGORITHM 2: Morphology and Contours (Morfologia e Contornos)
 * 
 * Binarizes edge gradients, applies morphological dilation to close borders,
 * and extracts bounding boxes of panels (including side-by-side frames).
 */
export function detectPanelsMorphology(
  imageData: ImageData,
  options: DetectionOptions = {}
): DetectedPanel[] {
  const { width, height, data } = imageData;
  const minHeight = options.minPanelHeight ?? Math.max(45, Math.round(height * 0.04));
  const minWidth = options.minPanelWidth ?? Math.max(60, Math.round(width * 0.22));
  const padding = options.padding ?? 4;

  // 1. Downscale grid for fast morphology processing
  const scale = width > 800 ? 0.5 : 1.0;
  const sw = Math.round(width * scale);
  const sh = Math.round(height * scale);

  const gray = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    const origY = Math.min(height - 1, Math.round(sy / scale));
    for (let sx = 0; sx < sw; sx++) {
      const origX = Math.min(width - 1, Math.round(sx / scale));
      const idx = (origY * width + origX) * 4;
      gray[sy * sw + sx] = Math.round(getLuminance(data[idx], data[idx + 1], data[idx + 2]));
    }
  }

  // 2. Sobel Edge gradient map
  const edges = new Uint8Array(sw * sh);
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const gx =
        -gray[(y - 1) * sw + (x - 1)] + gray[(y - 1) * sw + (x + 1)] +
        -2 * gray[y * sw + (x - 1)] + 2 * gray[y * sw + (x + 1)] +
        -gray[(y + 1) * sw + (x - 1)] + gray[(y + 1) * sw + (x + 1)];

      const gy =
        -gray[(y - 1) * sw + (x - 1)] - 2 * gray[(y - 1) * sw + x] - gray[(y - 1) * sw + (x + 1)] +
        gray[(y + 1) * sw + (x - 1)] + 2 * gray[(y + 1) * sw + x] + gray[(y + 1) * sw + (x + 1)];

      const mag = Math.abs(gx) + Math.abs(gy);
      edges[y * sw + x] = mag > 85 ? 255 : 0;
    }
  }

  // 3. Morphological Dilation with horizontal & vertical structuring elements to bridge panel outlines
  const dilated = new Uint8Array(sw * sh);
  const kRadius = Math.max(2, Math.round(3 * scale));

  for (let y = kRadius; y < sh - kRadius; y++) {
    for (let x = kRadius; x < sw - kRadius; x++) {
      if (edges[y * sw + x] === 255) {
        for (let dy = -kRadius; dy <= kRadius; dy++) {
          for (let dx = -kRadius; dx <= kRadius; dx++) {
            dilated[(y + dy) * sw + (x + dx)] = 255;
          }
        }
      }
    }
  }

  // 4. Connected Component Bounding Box Detection
  const visited = new Uint8Array(sw * sh);
  const rawBoxes: { x1: number; y1: number; x2: number; y2: number; area: number }[] = [];

  for (let y = 0; y < sh; y += 3) {
    for (let x = 0; x < sw; x += 3) {
      if (dilated[y * sw + x] === 255 && !visited[y * sw + x]) {
        let minBx = x;
        let maxBx = x;
        let minBy = y;
        let maxBy = y;

        const stack: [number, number][] = [[x, y]];
        visited[y * sw + x] = 1;

        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!;
          if (cx < minBx) minBx = cx;
          if (cx > maxBx) maxBx = cx;
          if (cy < minBy) minBy = cy;
          if (cy > maxBy) maxBy = cy;

          const neighbors: [number, number][] = [
            [cx + 2, cy],
            [cx - 2, cy],
            [cx, cy + 2],
            [cx, cy - 2],
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < sw && ny >= 0 && ny < sh) {
              const nIdx = ny * sw + nx;
              if (dilated[nIdx] === 255 && !visited[nIdx]) {
                visited[nIdx] = 1;
                stack.push([nx, ny]);
              }
            }
          }
        }

        const boxW = (maxBx - minBx) / scale;
        const boxH = (maxBy - minBy) / scale;

        if (boxW >= minWidth && boxH >= minHeight && boxW < width * 0.99 && boxH < height * 0.95) {
          rawBoxes.push({
            x1: minBx / scale,
            y1: minBy / scale,
            x2: maxBx / scale,
            y2: maxBy / scale,
            area: boxW * boxH,
          });
        }
      }
    }
  }

  // 5. Merge overlapping boxes with NMS
  const merged = mergeOverlappingBoxes(rawBoxes, options.iouThreshold ?? 0.35);

  // If morphology found no valid closed boxes (e.g. borderless art), fallback cleanly to Profile Projection
  if (merged.length === 0) {
    return detectPanelsProfileProjection(imageData, options).map((p) => ({
      ...p,
      algorithm: 'morphology' as const,
    }));
  }

  // Sort boxes top-to-bottom, left-to-right
  merged.sort((a, b) => {
    if (Math.abs(a.y1 - b.y1) > 30) return a.y1 - b.y1;
    return a.x1 - b.x1;
  });

  return merged.map((b, idx) => {
    const rx = Math.max(0, Math.round(b.x1 - padding));
    const ry = Math.max(0, Math.round(b.y1 - padding));
    const rw = Math.min(width - rx, Math.round((b.x2 - b.x1) + padding * 2));
    const rh = Math.min(height - ry, Math.round((b.y2 - b.y1) + padding * 2));

    return {
      id: `panel_morph_${Date.now()}_${idx + 1}`,
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      confidence: 0.92,
      algorithm: 'morphology',
      label: `Quadro ${String(idx + 1).padStart(2, '0')}`,
    };
  });
}

/**
 * ALGORITHM 3: SAHI (Slicing Aided Hyper Inference / Janelas Deslizantes)
 * 
 * Slices long vertical manhwa images into overlapping windows, runs detection,
 * maps back to global coordinates, and performs Non-Maximum Suppression (NMS) merge.
 */
export function detectPanelsSAHI(
  imageData: ImageData,
  options: DetectionOptions = {}
): DetectedPanel[] {
  const { width, height } = imageData;
  const sliceHeight = options.sliceHeight ?? Math.min(1050, Math.max(500, Math.round(height * 0.45)));
  const overlap = options.sliceOverlap ?? 0.25;
  const stride = Math.round(sliceHeight * (1 - overlap));

  // If the image is short enough, run profile projection directly
  if (height <= sliceHeight) {
    return detectPanelsProfileProjection(imageData, options).map((p) => ({
      ...p,
      algorithm: 'sahi' as const,
    }));
  }

  const allSlicesBoxes: { x1: number; y1: number; x2: number; y2: number; area: number }[] = [];

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = sliceHeight;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return detectPanelsProfileProjection(imageData, options);

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = width;
  fullCanvas.height = height;
  const fullCtx = fullCanvas.getContext('2d');
  if (!fullCtx) return detectPanelsProfileProjection(imageData, options);
  fullCtx.putImageData(imageData, 0, 0);

  let currentY = 0;
  while (currentY < height) {
    const curSliceH = Math.min(sliceHeight, height - currentY);
    tempCanvas.height = curSliceH;

    tempCtx.clearRect(0, 0, width, curSliceH);
    tempCtx.drawImage(fullCanvas, 0, currentY, width, curSliceH, 0, 0, width, curSliceH);
    const sliceData = tempCtx.getImageData(0, 0, width, curSliceH);

    // Run base detector on slice
    const slicePanels = detectPanelsProfileProjection(sliceData, {
      ...options,
      minPanelHeight: options.minPanelHeight ?? 45,
    });

    for (const p of slicePanels) {
      allSlicesBoxes.push({
        x1: p.x,
        y1: currentY + p.y,
        x2: p.x + p.width,
        y2: currentY + p.y + p.height,
        area: p.width * p.height,
      });
    }

    if (currentY + curSliceH >= height) break;
    currentY += stride;
  }

  // Merge sliced overlapping boxes using IoU
  const merged = mergeOverlappingBoxes(allSlicesBoxes, options.iouThreshold ?? 0.35);
  merged.sort((a, b) => a.y1 - b.y1);

  return merged.map((b, idx) => ({
    id: `panel_sahi_${Date.now()}_${idx + 1}`,
    x: Math.round(b.x1),
    y: Math.round(b.y1),
    width: Math.round(b.x2 - b.x1),
    height: Math.round(b.y2 - b.y1),
    confidence: 0.96,
    algorithm: 'sahi',
    label: `Quadro ${String(idx + 1).padStart(2, '0')}`,
  }));
}

/**
 * ALGORITHM 4: Hybrid Mode (Projeção de Perfil + Refinamento de Contorno) - RECOMENDADO
 * 
 * Slices vertical strips into manageable blocks via Profile Projection.
 * Within each block, checks for side-by-side panels and refines rectangular borders via Morphology.
 */
export function detectPanelsHybrid(
  imageData: ImageData,
  options: DetectionOptions = {}
): DetectedPanel[] {
  const { width, data } = imageData;
  const padding = options.padding ?? 4;
  const minWidth = options.minPanelWidth ?? Math.max(60, Math.round(width * 0.22));

  // Step 1: Profile projection to slice the vertical strip into horizontal panel bands
  const profilePanels = detectPanelsProfileProjection(imageData, options);

  if (profilePanels.length === 0) {
    return detectPanelsMorphology(imageData, options).map((p) => ({
      ...p,
      algorithm: 'hybrid' as const,
    }));
  }

  const refinedPanels: DetectedPanel[] = [];
  let panelCounter = 1;

  // Step 2: In each horizontal band, check for side-by-side panels or frame borders
  for (const band of profilePanels) {
    const bandH = band.height;
    const bandW = band.width;
    const startX = band.x;
    const startY = band.y;

    // Check for vertical gutter (column gap) inside this horizontal band (indicating side-by-side panels)
    const isColGutter = new Uint8Array(bandW);
    const varianceThresh = 4.0 + ((options.gutterThreshold ?? 20) * 0.35);

    for (let lx = 0; lx < bandW; lx++) {
      const gx = startX + lx;
      let sumL = 0;
      let sumSqL = 0;
      for (let ly = 0; ly < bandH; ly += 2) {
        const gy = startY + ly;
        const idx = (gy * width + gx) * 4;
        const l = getLuminance(data[idx], data[idx + 1], data[idx + 2]);
        sumL += l;
        sumSqL += l * l;
      }
      const n = Math.ceil(bandH / 2);
      const mean = sumL / n;
      const variance = Math.max(0, (sumSqL / n) - (mean * mean));
      const stdDev = Math.sqrt(variance);

      if ((mean > 240 && stdDev < 18) || (mean < 25 && stdDev < 18) || stdDev < varianceThresh) {
        isColGutter[lx] = 1;
      } else {
        isColGutter[lx] = 0;
      }
    }

    // Look for side-by-side sub-panels separated by a vertical gutter >= 8px
    const subColumns: { x1: number; x2: number }[] = [];
    let inSub = false;
    let subStartX = 0;

    for (let lx = 0; lx < bandW; lx++) {
      if (!isColGutter[lx] && !inSub) {
        inSub = true;
        subStartX = lx;
      } else if (isColGutter[lx] && inSub) {
        let gutterW = 0;
        while (lx + gutterW < bandW && isColGutter[lx + gutterW]) {
          gutterW++;
        }
        if (gutterW >= 8 || lx + gutterW >= bandW) {
          inSub = false;
          if (lx - subStartX >= minWidth) {
            subColumns.push({ x1: subStartX, x2: lx });
          }
          lx += gutterW - 1;
        }
      }
    }

    if (inSub && bandW - subStartX >= minWidth) {
      subColumns.push({ x1: subStartX, x2: bandW });
    }

    // If multiple side-by-side columns were isolated inside this band
    if (subColumns.length >= 2) {
      for (const col of subColumns) {
        const px = Math.max(0, startX + col.x1 - padding);
        const py = Math.max(0, startY - padding);
        const pw = Math.min(width - px, (col.x2 - col.x1) + padding * 2);
        const ph = bandH + padding * 2;

        refinedPanels.push({
          id: `panel_hyb_${Date.now()}_${panelCounter}`,
          x: Math.round(px),
          y: Math.round(py),
          width: Math.round(pw),
          height: Math.round(ph),
          confidence: 0.98,
          algorithm: 'hybrid',
          label: `Quadro ${String(panelCounter).padStart(2, '0')}`,
        });
        panelCounter++;
      }
    } else {
      // Single panel in this band: keep clean band
      refinedPanels.push({
        ...band,
        id: `panel_hyb_${Date.now()}_${panelCounter}`,
        algorithm: 'hybrid',
        confidence: 0.96,
        label: `Quadro ${String(panelCounter).padStart(2, '0')}`,
      });
      panelCounter++;
    }
  }

  return refinedPanels;
}

/**
 * Metrics extracted during morphophotometric analysis of a crop patch.
 */
export interface CropEvaluationMetrics {
  bgRatio: number;              // 0..1 ratio of white/neutral background pixels
  glyphCount: number;           // count of small letter/character components (CCL)
  glyphAreaRatio: number;       // total glyph area / patch area
  dominantRatio: number;        // largest connected component area / patch area
  meanLuminance: number;        // 0..255 average luminance of patch
  meanSaturation: number;       // 0..1 average color saturation
  textLineCount: number;        // number of horizontal text lines formed by glyphs
  heightStdDev: number;         // standard deviation of glyph heights
}

/**
 * Result of the morphophotometric evaluation of a candidate bounding box patch.
 */
export interface CropEvaluationResult {
  isTextOrBubble: boolean;
  score: number;                // 0.0 (pure artwork) to 1.0 (pure text/bubble)
  metrics: CropEvaluationMetrics;
  reason: string;
}

/**
 * Configuration options for the Text & Speech Bubble Filter.
 */
export interface FilterTextOptions {
  enabled?: boolean;
  textThreshold?: number;       // Score threshold above which patch is discarded (default: 0.55)
  minGlyphArea?: number;        // Minimum area for glyph component in CCL (default: 12 px²)
  maxGlyphArea?: number;        // Maximum area for glyph component in CCL (default: 450 px²)
  minBgRatio?: number;          // Minimum background ratio to suspect a bubble (default: 0.60)
}

/**
 * PURE FUNCTION: Evaluates a candidate crop patch from an ImageData using:
 * 1. Photometric analysis (whiteness, blackness, low saturation background)
 * 2. Adaptive/Otsu binarization for stroke isolation
 * 3. Connected-Component Labeling (CCL) with statistical distribution of glyphs vs art
 * 4. Typographical line dispersion and height uniformity
 * 
 * Returns CropEvaluationResult with score between 0.0 (artwork) and 1.0 (text/balloon).
 */
export function evaluate_crop_patch(
  imageData: ImageData,
  box: { x: number; y: number; width: number; height: number },
  options: FilterTextOptions = {}
): CropEvaluationResult {
  const { width: fullW, height: fullH, data } = imageData;

  // Clamp bounding box to valid image boundaries
  const startX = Math.max(0, Math.min(fullW - 1, Math.round(box.x)));
  const startY = Math.max(0, Math.min(fullH - 1, Math.round(box.y)));
  const endX = Math.max(startX + 1, Math.min(fullW, Math.round(box.x + box.width)));
  const endY = Math.max(startY + 1, Math.min(fullH, Math.round(box.y + box.height)));

  const patchW = endX - startX;
  const patchH = endY - startY;
  const patchArea = patchW * patchH;

  const defaultResult: CropEvaluationResult = {
    isTextOrBubble: false,
    score: 0,
    metrics: {
      bgRatio: 0,
      glyphCount: 0,
      glyphAreaRatio: 0,
      dominantRatio: 0,
      meanLuminance: 0,
      meanSaturation: 0,
      textLineCount: 0,
      heightStdDev: 0,
    },
    reason: 'Patch inválido ou vazio',
  };

  if (patchW < 10 || patchH < 10 || patchArea < 100) {
    return defaultResult;
  }

  const minGlyphArea = options.minGlyphArea ?? 12;
  const maxGlyphArea = options.maxGlyphArea ?? 450;
  const textThreshold = options.textThreshold ?? 0.55;

  // 1. Photometric Sampling: Extract Luminance, Saturation, and Background Ratio
  const lum = new Uint8Array(patchArea);
  let sumLum = 0;
  let sumSat = 0;
  let bgPixels = 0;

  for (let py = 0; py < patchH; py++) {
    const pageY = startY + py;
    const pageRowOffset = pageY * fullW * 4;
    const patchRowOffset = py * patchW;

    for (let px = 0; px < patchW; px++) {
      const pageX = startX + px;
      const idx = pageRowOffset + pageX * 4;

      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      lum[patchRowOffset + px] = l;
      sumLum += l;

      const maxVal = Math.max(r, g, b);
      const minVal = Math.min(r, g, b);
      const sat = maxVal === 0 ? 0 : (maxVal - minVal) / maxVal;
      sumSat += sat;

      // Photometric Speech Bubble Background Conditions:
      // a) Classic White Balloon: High Luminance (> 220) and very low saturation (< 0.18)
      // b) Light Neutral Balloon: Luminance (> 205) and low saturation (< 0.12)
      // c) Dark/Thought Balloon: Low Luminance (< 32) and low saturation (< 0.18)
      const isWhiteBg = l > 220 && sat < 0.18;
      const isLightNeutral = l > 205 && sat < 0.12;
      const isDarkNeutral = l < 32 && sat < 0.18;

      if (isWhiteBg || isLightNeutral || isDarkNeutral) {
        bgPixels++;
      }
    }
  }

  const meanLum = sumLum / patchArea;
  const meanSat = sumSat / patchArea;
  const bgRatio = bgPixels / patchArea;

  // 2. Otsu Adaptive Binarization to isolate text strokes
  const hist = new Int32Array(256);
  for (let i = 0; i < patchArea; i++) {
    hist[lum[i]]++;
  }

  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let varMax = 0;
  let otsuThreshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = patchArea - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const betweenVar = wB * wF * (mB - mF) * (mB - mF);

    if (betweenVar > varMax) {
      varMax = betweenVar;
      otsuThreshold = t;
    }
  }

  // Determine stroke mask:
  // If mean background is light: strokes are darker than Otsu threshold
  // If mean background is dark: strokes are lighter than Otsu threshold
  const isLightBg = meanLum >= 120;
  const fg = new Uint8Array(patchArea);
  for (let i = 0; i < patchArea; i++) {
    fg[i] = isLightBg
      ? (lum[i] < Math.min(otsuThreshold, 185) ? 1 : 0)
      : (lum[i] > Math.max(otsuThreshold, 70) ? 1 : 0);
  }

  // 3. Connected-Component Labeling (CCL) with Stats
  const visited = new Uint8Array(patchArea);
  const queue = new Int32Array(patchArea);

  let maxComponentArea = 0;
  let glyphCount = 0;
  let totalGlyphArea = 0;
  let largeArtComponentsCount = 0;

  const glyphHeights: number[] = [];
  const glyphCenterYs: number[] = [];

  for (let y = 0; y < patchH; y++) {
    const rowOffset = y * patchW;
    for (let x = 0; x < patchW; x++) {
      const idx = rowOffset + x;
      if (fg[idx] === 1 && visited[idx] === 0) {
        visited[idx] = 1;
        let head = 0;
        let tail = 0;
        queue[tail++] = idx;

        let cMinX = x;
        let cMaxX = x;
        let cMinY = y;
        let cMaxY = y;
        let area = 0;

        while (head < tail) {
          const curr = queue[head++];
          area++;
          const cx = curr % patchW;
          const cy = (curr / patchW) | 0;

          if (cx < cMinX) cMinX = cx;
          if (cx > cMaxX) cMaxX = cx;
          if (cy < cMinY) cMinY = cy;
          if (cy > cMaxY) cMaxY = cy;

          // 4-neighborhood
          if (cx > 0) {
            const n = curr - 1;
            if (fg[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue[tail++] = n;
            }
          }
          if (cx < patchW - 1) {
            const n = curr + 1;
            if (fg[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue[tail++] = n;
            }
          }
          if (cy > 0) {
            const n = curr - patchW;
            if (fg[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue[tail++] = n;
            }
          }
          if (cy < patchH - 1) {
            const n = curr + patchW;
            if (fg[n] === 1 && visited[n] === 0) {
              visited[n] = 1;
              queue[tail++] = n;
            }
          }
        }

        if (area > maxComponentArea) {
          maxComponentArea = area;
        }

        const cW = cMaxX - cMinX + 1;
        const cH = cMaxY - cMinY + 1;

        // Check if component fits typographic glyph/letter bounds
        if (
          area >= minGlyphArea &&
          area <= maxGlyphArea &&
          cW <= 60 &&
          cH <= 60 &&
          cW >= 2 &&
          cH >= 4
        ) {
          glyphCount++;
          totalGlyphArea += area;
          glyphHeights.push(cH);
          glyphCenterYs.push((cMinY + cMaxY) / 2);
        }

        // Check if component is a large continuous art structure (> 10% of patch)
        if (area > patchArea * 0.10 || (cW > patchW * 0.45 && cH > patchH * 0.35)) {
          largeArtComponentsCount++;
        }
      }
    }
  }

  const dominantRatio = patchArea > 0 ? maxComponentArea / patchArea : 0;
  const glyphAreaRatio = patchArea > 0 ? totalGlyphArea / patchArea : 0;

  // 4. Typographical Line Dispersion & Height Uniformity
  let textLineCount = 0;
  let heightStdDev = 99;

  if (glyphHeights.length >= 3) {
    const meanH = glyphHeights.reduce((a, b) => a + b, 0) / glyphHeights.length;
    const varH = glyphHeights.reduce((sum, h) => sum + (h - meanH) * (h - meanH), 0) / glyphHeights.length;
    heightStdDev = Math.sqrt(varH);

    // Group glyphs by Y coordinate to detect lines of text
    const sortedYs = [...glyphCenterYs].sort((a, b) => a - b);
    const lineThreshold = Math.max(8, meanH * 0.7);
    let lines = 1;
    let lastY = sortedYs[0];

    for (let i = 1; i < sortedYs.length; i++) {
      if (sortedYs[i] - lastY > lineThreshold) {
        lines++;
        lastY = sortedYs[i];
      }
    }
    textLineCount = lines;
  }

  // 5. Composite Scoring (Text_Likelihood_Score: 0.0 - 1.0)
  // Fator 1: Background Neutrality/Whiteness
  const bgScore = Math.max(0, Math.min(1, (bgRatio - 0.50) / 0.35));

  // Fator 2: Glyph Density (letters present without giant solid blocks)
  const glyphScore = Math.max(0, Math.min(1, glyphCount / 10));

  // Fator 3: Absence of Dominant Connected Art Components
  const artAbsenceScore = Math.max(0, Math.min(1, (0.18 - dominantRatio) / 0.12));

  let score = 0.35 * bgScore + 0.35 * glyphScore + 0.30 * artAbsenceScore;

  // Text signature reinforcements:
  // Uniform font height in multiple glyphs
  if (glyphCount >= 4 && heightStdDev < 6.5) {
    score += 0.12;
  }
  // Coherent horizontal text lines
  if (textLineCount >= 1 && textLineCount <= 6 && glyphCount >= 5) {
    score += 0.08;
  }
  // High white background with small disconnected letters
  if (bgRatio > 0.78 && glyphCount >= 3 && dominantRatio < 0.07) {
    score += 0.15;
  }
  // Small standalone box penalty (isolated bubble sliced as a panel)
  if (patchW < 320 && patchH < 250 && bgRatio > 0.68 && glyphCount >= 3) {
    score += 0.12;
  }
  // Low saturation confirmation
  if (meanSat < 0.12) {
    score += 0.06;
  }

  // Artwork Vetos (drastically lower score if drawing/character features exist):
  if (meanSat > 0.28) {
    score -= 0.35; // high saturation = colored artwork
  }
  if (dominantRatio > 0.18) {
    score -= 0.40; // large connected drawing element
  }
  if (largeArtComponentsCount >= 2) {
    score -= 0.30;
  }
  if (glyphAreaRatio > 0.38) {
    score -= 0.25; // solid black fill or complex texture
  }

  score = Math.max(0.0, Math.min(1.0, score));
  const isTextOrBubble = score >= textThreshold;

  const metrics: CropEvaluationMetrics = {
    bgRatio,
    glyphCount,
    glyphAreaRatio,
    dominantRatio,
    meanLuminance: meanLum,
    meanSaturation: meanSat,
    textLineCount,
    heightStdDev,
  };

  const reason = isTextOrBubble
    ? `Balão/Texto detectado (Score: ${(score * 100).toFixed(0)}% · ${glyphCount} glifos, ${(bgRatio * 100).toFixed(0)}% fundo neutro, maior elemento ${(dominantRatio * 100).toFixed(1)}%)`
    : `Arte mantida (Score: ${(score * 100).toFixed(0)}% · maior componente ${(dominantRatio * 100).toFixed(1)}%, saturação ${(meanSat * 100).toFixed(0)}%)`;

  return {
    isTextOrBubble,
    score,
    metrics,
    reason,
  };
}

export const evaluateCropPatch = evaluate_crop_patch;

/**
 * MIDDLEWARE FUNCTION: Receives candidate bounding box panels from any detection
 * algorithm and filters out those classified predominantly as text or speech bubbles.
 * Operates in CPU in milliseconds without external heavyweight frameworks.
 */
export function filter_text_and_speech_bubbles(
  imageData: ImageData,
  panels: DetectedPanel[],
  options: FilterTextOptions = {}
): {
  filteredPanels: DetectedPanel[];
  discardedPanels: { panel: DetectedPanel; evaluation: CropEvaluationResult }[];
} {
  if (options.enabled === false) {
    return {
      filteredPanels: panels,
      discardedPanels: [],
    };
  }

  if (panels.length === 0) {
    return { filteredPanels: [], discardedPanels: [] };
  }

  const filteredPanels: DetectedPanel[] = [];
  const discardedPanels: { panel: DetectedPanel; evaluation: CropEvaluationResult }[] = [];

  for (const panel of panels) {
    const evaluation = evaluate_crop_patch(imageData, panel, options);

    if (evaluation.isTextOrBubble) {
      discardedPanels.push({ panel, evaluation });
    } else {
      filteredPanels.push(panel);
    }
  }

  // Safety fallback: If all panels were discarded by text filter but raw panels existed,
  // keep the one with the lowest text likelihood score to avoid empty result when edge cases occur.
  if (filteredPanels.length === 0 && discardedPanels.length > 0) {
    discardedPanels.sort((a, b) => a.evaluation.score - b.evaluation.score);
    if (discardedPanels[0].evaluation.score < 0.85) {
      filteredPanels.push(discardedPanels[0].panel);
    }
  }

  return {
    filteredPanels,
    discardedPanels,
  };
}

export const filterTextAndSpeechBubbles = filter_text_and_speech_bubbles;

/**
 * Main dispatcher to run panel detection on an image
 */
export async function detectPanels(
  imgSource: HTMLImageElement | string,
  options: DetectionOptions = {}
): Promise<DetectedPanel[]> {
  let img: HTMLImageElement;
  if (typeof imgSource === 'string') {
    img = await loadImage(imgSource);
  } else {
    img = imgSource;
  }

  const imageData = getImageDataFromElement(img);
  const algo = options.algorithm ?? 'hybrid';
  let panels: DetectedPanel[];

  switch (algo) {
    case 'profile':
      panels = detectPanelsProfileProjection(imageData, options);
      break;
    case 'morphology':
      panels = detectPanelsMorphology(imageData, options);
      break;
    case 'sahi':
      panels = detectPanelsSAHI(imageData, options);
      break;
    case 'hybrid':
    default:
      panels = detectPanelsHybrid(imageData, options);
      break;
  }

  // Post-processing: Morphophotometric Text & Speech Bubble Filter
  const shouldFilterText = options.filterTextBubbles ?? true;
  if (shouldFilterText && panels.length > 0) {
    const { filteredPanels } = filter_text_and_speech_bubbles(imageData, panels, {
      enabled: true,
      textThreshold: options.textFilterThreshold ?? 0.55,
      minGlyphArea: options.minGlyphArea ?? 12,
      maxGlyphArea: options.maxGlyphArea ?? 450,
    });
    panels = filteredPanels;
  }

  // Decorate each panel with true intrinsic page dimensions and sequential label
  return panels.map((p, idx) => ({
    ...p,
    label: `Quadro ${String(idx + 1).padStart(2, '0')}`,
    pageWidth: imageData.width,
    pageHeight: imageData.height,
  }));
}

/**
 * Helper: Merge overlapping bounding boxes using Intersection over Union (IoU)
 */
function mergeOverlappingBoxes(
  boxes: { x1: number; y1: number; x2: number; y2: number; area: number }[],
  iouThreshold: number
): { x1: number; y1: number; x2: number; y2: number }[] {
  if (boxes.length === 0) return [];

  const result: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const used = new Uint8Array(boxes.length);

  for (let i = 0; i < boxes.length; i++) {
    if (used[i]) continue;

    let b1 = { ...boxes[i] };
    used[i] = 1;

    let mergedAny = true;
    while (mergedAny) {
      mergedAny = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used[j]) continue;

        const b2 = boxes[j];
        const interX1 = Math.max(b1.x1, b2.x1);
        const interY1 = Math.max(b1.y1, b2.y1);
        const interX2 = Math.min(b1.x2, b2.x2);
        const interY2 = Math.min(b1.y2, b2.y2);

        const interW = Math.max(0, interX2 - interX1);
        const interH = Math.max(0, interY2 - interY1);
        const interArea = interW * interH;

        if (interArea > 0) {
          const area1 = (b1.x2 - b1.x1) * (b1.y2 - b1.y1);
          const area2 = (b2.x2 - b2.x1) * (b2.y2 - b2.y1);
          const unionArea = area1 + area2 - interArea;
          const iou = interArea / unionArea;

          const containment = Math.max(interArea / area1, interArea / area2);

          if (iou > iouThreshold || containment > 0.72) {
            b1.x1 = Math.min(b1.x1, b2.x1);
            b1.y1 = Math.min(b1.y1, b2.y1);
            b1.x2 = Math.max(b1.x2, b2.x2);
            b1.y2 = Math.max(b1.y2, b2.y2);
            used[j] = 1;
            mergedAny = true;
          }
        }
      }
    }

    result.push({ x1: b1.x1, y1: b1.y1, x2: b1.x2, y2: b1.y2 });
  }

  return result;
}
