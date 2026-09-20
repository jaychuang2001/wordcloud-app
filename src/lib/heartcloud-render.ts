import type { Palette } from "./wordcloud-core";
import { computeMaskInsideMap, loadMaskImage, paintMaskBackground } from "./wordcloud-render";
import type { MaskSource } from "./wordcloud-render";

export type { MaskSource };

export type HeartCloudOptions = {
  canvas: HTMLCanvasElement;
  counts: Record<string, number>;
  palette: Palette;
  mask: MaskSource;
  maxHearts?: number;
};

type PlacedHeart = { x: number; y: number; r: number };

/** A classic ❤ outline, centered horizontally at cx, spanning [cy, cy+size] vertically. */
function heartPath(ctx: CanvasRenderingContext2D, cx: number, cyTop: number, size: number) {
  const top = size * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx, cyTop + top);
  ctx.bezierCurveTo(cx, cyTop, cx - size / 2, cyTop, cx - size / 2, cyTop + top);
  ctx.bezierCurveTo(
    cx - size / 2,
    cyTop + (size + top) / 2,
    cx,
    cyTop + (size + top) / 2,
    cx,
    cyTop + size,
  );
  ctx.bezierCurveTo(
    cx,
    cyTop + (size + top) / 2,
    cx + size / 2,
    cyTop + (size + top) / 2,
    cx + size / 2,
    cyTop + top,
  );
  ctx.bezierCurveTo(cx + size / 2, cyTop, cx, cyTop, cx, cyTop + top);
  ctx.closePath();
}

const FONT_STACK = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';

function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize = 9,
): number {
  let size = Math.max(minSize, Math.round(startSize));
  ctx.font = `700 ${size}px ${FONT_STACK}`;
  while (size > minSize && ctx.measureText(text).width > maxWidth) {
    size -= 1;
    ctx.font = `700 ${size}px ${FONT_STACK}`;
  }
  return size;
}

function truncateForWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return t.length < text.length ? `${t}…` : t;
}

let renderToken = 0;

type Entry = [string, number];

type LayoutResult = { placed: (PlacedHeart & { word: string; size: number })[]; unplacedCount: number };

/** Dry-run placement pass at a given size scale — no drawing, just geometry. */
function computeLayout(
  entries: Entry[],
  sizeFor: (weight: number) => number,
  scale: number,
  isInside: (x: number, y: number) => boolean,
  hasMask: boolean,
  bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number },
): LayoutResult {
  const { minX, minY, maxX, maxY, width, height } = bounds;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const placed: (PlacedHeart & { word: string; size: number })[] = [];
  let unplacedCount = 0;

  for (const [word, weight] of entries) {
    const size = sizeFor(weight) * scale;
    const radius = size * 0.58;
    let ok = false;

    for (let attempt = 0; attempt < 60 && !ok; attempt++) {
      const cx = minX + radius + Math.random() * Math.max(1, spanX - radius * 2);
      const cy = minY + radius + Math.random() * Math.max(1, spanY - radius * 2);

      if (hasMask) {
        const pad = radius * 0.85;
        const corners: [number, number][] = [
          [cx, cy],
          [cx - pad, cy],
          [cx + pad, cy],
          [cx, cy - pad],
          [cx, cy + pad],
        ];
        if (!corners.every(([px, py]) => isInside(px, py))) continue;
      } else if (cx - radius < 0 || cx + radius > width || cy - radius < 0 || cy + radius > height) {
        continue;
      }

      const collides = placed.some((h) => {
        const dx = h.x - cx;
        const dy = h.y - cy;
        return Math.hypot(dx, dy) < (h.r + radius) * 0.86;
      });
      if (collides) continue;

      placed.push({ word, x: cx, y: cy, r: radius, size });
      ok = true;
    }
    if (!ok) unplacedCount++;
  }

  return { placed, unplacedCount };
}

/**
 * Renders each word as its own heart (sized by how often it was submitted),
 * scattered without overlap inside the mask shape (or the whole canvas when
 * there's no mask). When there isn't room for everyone, all hearts shrink
 * together and the layout is retried — same "shrink to fit" idea as the
 * classic text cloud — rather than silently dropping the newest words.
 */
export async function renderHeartCloud({
  canvas,
  counts,
  palette,
  mask,
  maxHearts = 140,
}: HeartCloudOptions): Promise<void> {
  const token = ++renderToken;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  let inside: Uint8Array | null = null;
  if (mask) {
    try {
      const img = await loadMaskImage(mask.dataUrl);
      if (token !== renderToken) return;
      inside = computeMaskInsideMap(img, width, height);
      // Paint the same background-blend trick as the classic mode, so the
      // shape outline reads the same way whichever mode is active.
      await paintMaskBackground(canvas, mask.dataUrl, palette.background);
      if (token !== renderToken) return;
    } catch {
      inside = null;
    }
  }

  const isInside = (x: number, y: number): boolean => {
    if (!inside) return x >= 0 && x < width && y >= 0 && y < height;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= width || yi < 0 || yi >= height) return false;
    return inside[yi * width + xi] === 1;
  };

  // Bounding box of usable space, so random placement doesn't waste attempts
  // sampling points far outside a small mask.
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;
  if (inside) {
    minX = width;
    minY = height;
    maxX = 0;
    maxY = 0;
    const step = 4;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (inside[y * width + x] === 1) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) {
      minX = 0;
      minY = 0;
      maxX = width;
      maxY = height;
    }
  }

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxHearts) as Entry[];
  if (entries.length === 0) return;

  const max = entries[0]![1];
  const base = Math.min(width, height);
  const sizeFor = (weight: number) => {
    const ratio = Math.sqrt(weight / max);
    return Math.max(base * 0.05, Math.min(base * 0.17, ratio * base * 0.15));
  };

  const bounds = { minX, minY, maxX, maxY, width, height };

  // Shrink-to-fit: if not everyone fits at full size, scale every heart down
  // together and retry the whole layout, same as the classic cloud does.
  let scale = 1;
  let layout = computeLayout(entries, sizeFor, scale, isInside, Boolean(inside), bounds);
  let iterations = 0;
  while (layout.unplacedCount > 0 && scale > 0.3 && iterations < 8) {
    scale *= 0.85;
    layout = computeLayout(entries, sizeFor, scale, isInside, Boolean(inside), bounds);
    iterations++;
  }

  const heartColor = "#e11d2e";
  const textColor = "#ffffff";

  for (const h of layout.placed) {
    ctx.save();
    ctx.fillStyle = heartColor;
    heartPath(ctx, h.x, h.y - h.size / 2, h.size);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = h.size * 0.72;
    const fitted = fitFontSize(ctx, h.word, maxTextWidth, h.size * 0.26);
    ctx.font = `700 ${fitted}px ${FONT_STACK}`;
    const label = truncateForWidth(ctx, h.word, maxTextWidth);
    ctx.fillText(label, h.x, h.y - h.size * 0.12);
    ctx.restore();
  }
  // Anything still unplaced after the minimum scale is reached is silently
  // dropped (lowest-frequency words first, since entries are sorted by
  // weight) — an extreme edge case only hit when the mask area is tiny.
}
