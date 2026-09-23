import type { Palette } from "./wordcloud-core";

export type MaskSource = { dataUrl: string } | null;
export type ExcludeRect = { x: number; y: number; width: number; height: number };

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const int = parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/**
 * wordcloud2 (clearCanvas: false) treats pixels matching the background colour
 * as free space. So the inside of the shape gets the exact background colour
 * and everything outside gets a near-identical colour that blocks words but
 * looks the same on screen.
 */
export async function loadMaskImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("mask_load_failed"));
    image.src = dataUrl;
  });
}

// Decoding the mask image and scanning every pixel is the expensive part of
// using a shape mask. The mask itself rarely changes between redraws (new
// words trigger a redraw far more often than a new mask upload), so cache
// the result and only redo the work when the mask or canvas size changes.
let maskFieldCache: { key: string; inside: Uint8Array } | null = null;

function maskCacheKey(dataUrl: string, width: number, height: number): string {
  // dataUrl can be several MB; hashing the whole thing on every redraw would
  // defeat the point of caching, so fingerprint it cheaply instead.
  return `${dataUrl.length}:${dataUrl.slice(0, 48)}:${width}x${height}`;
}

export async function getMaskInsideMap(
  dataUrl: string,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const key = maskCacheKey(dataUrl, width, height);
  if (maskFieldCache && maskFieldCache.key === key) return maskFieldCache.inside;
  const img = await loadMaskImage(dataUrl);
  const inside = computeMaskInsideMap(img, width, height);
  maskFieldCache = { key, inside };
  return inside;
}

function getMaskDrawRect(img: HTMLImageElement, width: number, height: number) {
  const scale = Math.min(width / img.width, height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = (width - w) / 2;
  const dy = (height - h) / 2;
  return { w, h, dx, dy };
}

/**
 * Returns a width*height boolean map (1 = inside the shape / usable space).
 * Shared by the classic text cloud (background-colour trick) and the heart
 * cloud (direct placement queries).
 */
export function computeMaskInsideMap(
  img: HTMLImageElement,
  width: number,
  height: number,
): Uint8Array {
  const off = document.createElement("canvas");
  off.width = width;
  off.height = height;
  const octx = off.getContext("2d", { willReadFrequently: true });
  const inside = new Uint8Array(width * height);
  if (!octx) return inside;

  const { w, h, dx, dy } = getMaskDrawRect(img, width, height);
  octx.fillStyle = "#ffffff";
  octx.fillRect(0, 0, width, height);
  octx.drawImage(img, dx, dy, w, h);

  const frame = octx.getImageData(0, 0, width, height);
  const px = frame.data;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const alpha = px[i + 3]!;
    const luminance = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
    // Black in the source = usable space for words; white/transparent = the
    // visible pattern that stays on screen.
    inside[p] = alpha > 128 && luminance < 128 ? 1 : 0;
  }
  return inside;
}

/**
 * Paints the mask image so its white/light artwork stays visible on screen,
 * while the black areas (usable space for words) are erased back to the
 * exact background colour so they're ready to receive text.
 */
export async function paintMaskBackground(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  background: string,
): Promise<void> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const img = await loadMaskImage(dataUrl);
  const inside = await getMaskInsideMap(dataUrl, canvas.width, canvas.height);

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { w, h, dx, dy } = getMaskDrawRect(img, canvas.width, canvas.height);
  ctx.drawImage(img, dx, dy, w, h);

  const [br, bg, bb] = hexToRgb(background);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  for (let p = 0, i = 0; p < inside.length; p++, i += 4) {
    if (inside[p] === 1) {
      px[i] = br;
      px[i + 1] = bg;
      px[i + 2] = bb;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(frame, 0, 0);
}

export type MaskPreviewOptions = {
  canvas: HTMLCanvasElement;
  mask: MaskSource;
  excludeRects?: ExcludeRect[];
};

/**
 * Diagnostic view: paints "usable" space in green and blocked space (outside
 * the mask shape, plus the title/QR exclusion zones) in red, so the host can
 * check the mask is being read correctly before relying on it live.
 */
export async function renderMaskPreview({ canvas, mask, excludeRects }: MaskPreviewOptions): Promise<void> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;

  let inside: Uint8Array;
  if (mask) {
    try {
      inside = await getMaskInsideMap(mask.dataUrl, width, height);
    } catch {
      inside = new Uint8Array(width * height).fill(1);
    }
  } else {
    inside = new Uint8Array(width * height).fill(1);
  }

  const frame = ctx.createImageData(width, height);
  const px = frame.data;
  // Usable = translucent green; blocked = translucent red, over a dark base.
  for (let p = 0, i = 0; p < inside.length; p++, i += 4) {
    const isIn = inside[p] === 1;
    px[i] = isIn ? 34 : 190;
    px[i + 1] = isIn ? 197 : 40;
    px[i + 2] = isIn ? 94 : 40;
    px[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);

  if (excludeRects && excludeRects.length > 0) {
    ctx.save();
    ctx.fillStyle = "rgba(190, 40, 40, 0.9)";
    for (const r of excludeRects) ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 20px sans-serif";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 6;
  ctx.fillText("綠色 = 可以放字／形狀　紅色 = 禁區", 16, 16);
  ctx.restore();
}

export type RenderOptions = {
  canvas: HTMLCanvasElement;
  counts: Record<string, number>;
  palette: Palette;
  mask: MaskSource;
  rotate: boolean;
  maxWords?: number;
  /** UI overlays (title block, QR code, ...) that words must not be drawn under. */
  excludeRects?: ExcludeRect[];
};

/** Marks rectangles as blocked using the same near-identical-shade trick as the mask. */
function paintExclusionRects(
  canvas: HTMLCanvasElement,
  rects: ExcludeRect[] | undefined,
  background: string,
): void {
  if (!rects || rects.length === 0) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const [br, bg, bb] = hexToRgb(background);
  const nr = br > 8 ? br - 4 : br + 4;
  const ng = bg > 8 ? bg - 4 : bg + 4;
  const nb = bb > 8 ? bb - 4 : bb + 4;
  ctx.fillStyle = `rgb(${nr}, ${ng}, ${nb})`;
  for (const r of rects) {
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
}

let renderToken = 0;

export async function renderWordCloud({
  canvas,
  counts,
  palette,
  mask,
  rotate,
  maxWords = 220,
  excludeRects,
}: RenderOptions): Promise<void> {
  const token = ++renderToken;
  const WordCloudModule = await import("wordcloud");
  if (token !== renderToken) return;
  const WordCloud = (WordCloudModule.default ?? WordCloudModule) as unknown as (
    el: HTMLElement,
    options: Record<string, unknown>,
  ) => void;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // A mask shrinks the usable area a lot, and wordcloud2's placement search
  // gets disproportionately expensive on a small/irregular shape. Cap how
  // much work we ask for so a busy mask can't freeze the tab.
  const effectiveMaxWords = mask ? Math.min(maxWords, 90) : maxWords;

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, effectiveMaxWords);

  if (entries.length === 0) {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const max = entries[0]![1];
  const base = Math.min(canvas.width, canvas.height);
  const weightFactor = (weight: number) => {
    const ratio = Math.sqrt(weight / max);
    return Math.max(12, ratio * base * (mask ? 0.16 : 0.22));
  };

  if (mask) {
    await paintMaskBackground(canvas, mask.dataUrl, palette.background);
    if (token !== renderToken) return;
  } else {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  paintExclusionRects(canvas, excludeRects, palette.background);

  let colorIndex = 0;
  const originalFillText = ctx.fillText.bind(ctx);
  ctx.fillText = (text: string, x: number, y: number, maxWidth?: number) => {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(1.5, Number.parseFloat(ctx.font) * 0.035);
    ctx.strokeStyle = palette.stroke;
    if (maxWidth === undefined) ctx.strokeText(text, x, y);
    else ctx.strokeText(text, x, y, maxWidth);
    ctx.restore();
    if (maxWidth === undefined) originalFillText(text, x, y);
    else originalFillText(text, x, y, maxWidth);
  };

  const restoreFillText = () => {
    ctx.fillText = originalFillText;
    canvas.removeEventListener("wordcloudstop", restoreFillText);
  };
  canvas.addEventListener("wordcloudstop", restoreFillText, { once: true });
  // Safety net: if wordcloudstop never fires for some reason, don't leave
  // fillText permanently patched.
  window.setTimeout(restoreFillText, 8000);

  WordCloud(canvas, {
    list: entries,
    gridSize: Math.max(4, Math.round((base / 1000) * (mask ? 16 : 10))),
    weightFactor,
    minSize: 10,
    fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
    fontWeight: "700",
    color: () => palette.colors[colorIndex++ % palette.colors.length]!,
    backgroundColor: palette.background,
    clearCanvas: false,
    rotateRatio: rotate ? 0.35 : 0,
    rotationSteps: 2,
    minRotation: -Math.PI / 12,
    maxRotation: Math.PI / 12,
    shrinkToFit: true,
    drawOutOfBound: false,
  });
}
