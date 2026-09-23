import type { Palette } from "./wordcloud-core";
import { getMaskInsideMap, paintMaskBackground } from "./wordcloud-render";
import type { ExcludeRect, MaskSource } from "./wordcloud-render";

export type { ExcludeRect, MaskSource };

export type HeartCloudOptions = {
  canvas: HTMLCanvasElement;
  counts: Record<string, number>;
  palette: Palette;
  mask: MaskSource;
  maxHearts?: number;
  /** UI overlays (title block, QR code, ...) that shapes must not be drawn under. */
  excludeRects?: ExcludeRect[];
};

const FONT_STACK = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
// One glow-colour palette per shape, so hearts/stars/clouds read as distinct
// families at a glance.
const HEART_COLORS = ["#ff2d55", "#ff5470", "#ff3b3b", "#ff6b81", "#ff1744", "#ff477e"];
const STAR_COLORS = ["#ffd60a", "#ffe066", "#ffc300", "#ffdd57", "#ffb703"];
const CLOUD_COLORS = ["#4cc9f0", "#48bfe3", "#5390d9", "#4ea8de", "#56cfe1"];

type ShapeKind = "heart" | "star" | "cloud";
const SHAPE_KINDS: ShapeKind[] = ["heart", "star", "cloud"];

// Each word gets a genuinely random shape the first time it's seen, then
// keeps that shape for as long as it keeps appearing — so a word "grows"
// as one consistent shape rather than jumping between shapes on redraw.
const wordShapeCache = new Map<string, ShapeKind>();

function shapeForWord(word: string): ShapeKind {
  let shape = wordShapeCache.get(word);
  if (!shape) {
    shape = SHAPE_KINDS[Math.floor(Math.random() * SHAPE_KINDS.length)]!;
    wordShapeCache.set(word, shape);
  }
  return shape;
}

function colorsForShape(shape: ShapeKind): string[] {
  if (shape === "star") return STAR_COLORS;
  if (shape === "cloud") return CLOUD_COLORS;
  return HEART_COLORS;
}

/**
 * A plump ❤ outline (softened tip, not a sharp point), centered horizontally
 * at cx, spanning [cyTop, cyTop+size] vertically.
 */
function heartPath(ctx: CanvasRenderingContext2D, cx: number, cyTop: number, size: number) {
  const top = size * 0.32;
  const bottomY = cyTop + size;
  const tip = size * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx, cyTop + top);
  ctx.bezierCurveTo(cx, cyTop, cx - size / 2, cyTop, cx - size / 2, cyTop + top);
  ctx.bezierCurveTo(
    cx - size / 2,
    cyTop + (size + top) / 2,
    cx - tip,
    bottomY - tip * 1.4,
    cx - tip * 0.3,
    bottomY - tip * 0.3,
  );
  ctx.quadraticCurveTo(cx, bottomY, cx + tip * 0.3, bottomY - tip * 0.3);
  ctx.bezierCurveTo(
    cx + tip,
    bottomY - tip * 1.4,
    cx + size / 2,
    cyTop + (size + top) / 2,
    cx + size / 2,
    cyTop + top,
  );
  ctx.bezierCurveTo(cx + size / 2, cyTop, cx, cyTop, cx, cyTop + top);
  ctx.closePath();
}

/** A soft, rounded 5-point star (edges are smoothed, not sharp spikes). */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const outerR = size / 2;
  const innerR = outerR * 0.44;
  const points = 5;
  const verts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    verts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  const mid = (a: [number, number], b: [number, number]): [number, number] => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const n = verts.length;
  const start = mid(verts[n - 1]!, verts[0]!);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const next = verts[(i + 1) % n]!;
    const m = mid(verts[i]!, next);
    ctx.quadraticCurveTo(verts[i]![0], verts[i]![1], m[0], m[1]);
  }
  ctx.closePath();
}

/** A fluffy, rounded cloud outline (several overlapping bumps on top). */
function cloudPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const s = size / 70;
  const x = cx - 25 * s;
  const y = cy - 10 * s;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x - 10 * s, y + 5 * s, x - 10 * s, y + 15 * s, x, y + 20 * s);
  ctx.bezierCurveTo(x - 5 * s, y + 30 * s, x + 10 * s, y + 35 * s, x + 20 * s, y + 30 * s);
  ctx.bezierCurveTo(x + 30 * s, y + 40 * s, x + 50 * s, y + 30 * s, x + 45 * s, y + 15 * s);
  ctx.bezierCurveTo(x + 60 * s, y + 15 * s, x + 60 * s, y - 5 * s, x + 45 * s, y - 8 * s);
  ctx.bezierCurveTo(x + 45 * s, y - 20 * s, x + 25 * s, y - 20 * s, x + 20 * s, y - 8 * s);
  ctx.bezierCurveTo(x + 10 * s, y - 15 * s, x - 5 * s, y - 8 * s, x, y);
  ctx.closePath();
}

function drawShapePath(ctx: CanvasRenderingContext2D, shape: ShapeKind, cx: number, cy: number, size: number) {
  if (shape === "star") starPath(ctx, cx, cy, size);
  else if (shape === "cloud") cloudPath(ctx, cx, cy, size);
  else heartPath(ctx, cx, cy - size / 2, size);
}

/** Draws just the shape's outline with a soft neon glow (no fill). */
function drawGlowingShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeKind,
  cx: number,
  cy: number,
  size: number,
  color: string,
) {
  // Wide, soft glow pass underneath.
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.22;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.lineJoin = "round";
  drawShapePath(ctx, shape, cx, cy, size);
  ctx.stroke();
  ctx.restore();

  // Crisp inner line on top for a defined edge.
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.1;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.5, size * 0.022);
  ctx.lineJoin = "round";
  drawShapePath(ctx, shape, cx, cy, size);
  ctx.stroke();
  ctx.restore();
}

/** Vertical offset (as a fraction of size) so text sits visually centered in each shape. */
function textOffsetForShape(shape: ShapeKind): number {
  // The heart's rounded lobes make its visual "mass" sit above the
  // geometric bounding-box center (the bottom tapers to a point), so its
  // label needs to shift up a bit. Star and cloud are already close to
  // centered on their bounding box.
  if (shape === "heart") return -0.1;
  return 0;
}

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

type PlacedHeart = { word: string; weight: number; x: number; y: number; size: number };

let renderToken = 0;

/**
 * Renders each distinct word as its own glowing heart outline (no fill),
 * with the word centered inside, sized by how often it was submitted.
 * Hearts scatter without overlap inside the uploaded shape mask (or the
 * whole canvas without one). When there isn't room for everyone, all hearts
 * shrink together and placement is retried, same as the classic text
 * cloud's shrink-to-fit behaviour.
 *
 * Fully synchronous placement — no external layout library, no waiting on
 * events or timers — so a redraw always finishes in one tick.
 */
export async function renderHeartCloud({
  canvas,
  counts,
  palette,
  mask,
  maxHearts = 60,
  excludeRects,
}: HeartCloudOptions): Promise<void> {
  const token = ++renderToken;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  let outerInside: Uint8Array | null = null;
  if (mask) {
    try {
      outerInside = await getMaskInsideMap(mask.dataUrl, width, height);
      if (token !== renderToken) return;
      await paintMaskBackground(canvas, mask.dataUrl, palette.background);
      if (token !== renderToken) return;
    } catch {
      outerInside = null;
    }
  }

  if (excludeRects && excludeRects.length > 0) {
    if (!outerInside) outerInside = new Uint8Array(width * height).fill(1);
    for (const r of excludeRects) {
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(width, Math.ceil(r.x + r.width));
      const y1 = Math.min(height, Math.ceil(r.y + r.height));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) outerInside[y * width + x] = 0;
      }
    }
  }

  const isOuterInside = (x: number, y: number): boolean => {
    if (!outerInside) return x >= 0 && x < width && y >= 0 && y < height;
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || xi >= width || yi < 0 || yi >= height) return false;
    return outerInside[yi * width + xi] === 1;
  };

  // Bounding box of usable space, so random placement doesn't waste attempts
  // sampling points far outside a small mask.
  let minX = 0;
  let minY = 0;
  let maxX = width;
  let maxY = height;
  if (outerInside) {
    minX = width;
    minY = height;
    maxX = 0;
    maxY = 0;
    const step = 4;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (outerInside[y * width + x] === 1) {
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
    .slice(0, maxHearts);
  if (entries.length === 0) return;

  // Forget shapes for words no longer tracked at all, so this cache doesn't
  // grow unbounded over a long-running event.
  for (const key of wordShapeCache.keys()) {
    if (!(key in counts)) wordShapeCache.delete(key);
  }

  const maxWeight = entries[0]![1];
  const base = Math.min(width, height);
  const sizeFor = (weight: number) => {
    const ratio = Math.sqrt(weight / maxWeight);
    return Math.max(base * 0.06, Math.min(base * 0.2, ratio * base * 0.18));
  };

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const hasMask = Boolean(outerInside);

  // Shrink-to-fit: find non-overlapping positions for every heart; if some
  // don't fit, shrink everyone and retry the whole layout from scratch.
  const tryLayout = (scale: number): { placed: PlacedHeart[]; unplacedCount: number } => {
    const placed: PlacedHeart[] = [];
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
          if (!corners.every(([px, py]) => isOuterInside(px, py))) continue;
        } else if (
          cx - radius < 0 ||
          cx + radius > width ||
          cy - radius < 0 ||
          cy + radius > height
        ) {
          continue;
        }

        const collides = placed.some((h) => {
          const dx = h.x - cx;
          const dy = h.y - cy;
          return Math.hypot(dx, dy) < (h.size * 0.58 + radius) * 0.92;
        });
        if (collides) continue;

        placed.push({ word, weight, x: cx, y: cy, size });
        ok = true;
      }
      if (!ok) unplacedCount++;
    }
    return { placed, unplacedCount };
  };

  let scale = 1;
  let layout = tryLayout(scale);
  let iterations = 0;
  while (layout.unplacedCount > 0 && scale > 0.3 && iterations < 6) {
    scale *= 0.85;
    layout = tryLayout(scale);
    iterations++;
  }

  for (let i = 0; i < layout.placed.length; i++) {
    const h = layout.placed[i]!;
    const shape = shapeForWord(h.word);
    const colorSet = colorsForShape(shape);
    const color = colorSet[i % colorSet.length]!;

    drawGlowingShape(ctx, shape, h.x, h.y, h.size, color);

    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxTextWidth = h.size * 0.68;
    const fitted = fitFontSize(ctx, h.word, maxTextWidth, h.size * 0.24);
    ctx.font = `700 ${fitted}px ${FONT_STACK}`;
    const label = truncateForWidth(ctx, h.word, maxTextWidth);
    ctx.fillText(label, h.x, h.y + h.size * textOffsetForShape(shape));
    ctx.restore();
  }
  // Words that never found room after the minimum scale are silently
  // dropped (lowest-frequency first, since entries are sorted by weight) —
  // an extreme edge case only hit when the mask area is tiny.
}
