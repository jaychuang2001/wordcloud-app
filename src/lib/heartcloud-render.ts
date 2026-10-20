import type { Palette } from "./wordcloud-core";
import { getMaskInsideMap, maskMargin, paintMaskBackground } from "./wordcloud-render";
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
const LANTERN_COLORS = ["#ff9500", "#ff8c1a", "#ffa31a", "#ff7b00", "#ffa033"];

type ShapeKind = "heart" | "star" | "cloud" | "lantern";
// Four shapes, each picked with equal (25%) probability for a new word.
const SHAPE_KINDS: ShapeKind[] = ["heart", "star", "cloud", "lantern"];

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
  if (shape === "lantern") return LANTERN_COLORS;
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

/**
 * A sky lantern (天燈), traced from the reference picture: a rounded
 * pentagon-like body (soft apex, rounded shoulders) that tapers down to an
 * open round rim drawn as an ellipse. Units are fractions of `size`, with the
 * origin at the middle of the whole drawing (body + rim), height ~1, width ~0.82.
 */
function lanternPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const X = (u: number) => cx + u * size;
  const Y = (v: number) => cy + v * size;
  const apex: [number, number] = [0, -0.522];
  const lSh: [number, number] = [-0.412, -0.312];
  const rSh: [number, number] = [0.412, -0.312];
  const bl: [number, number] = [-0.232, 0.463];
  const br: [number, number] = [0.232, 0.463];
  const rApex = 0.18 * size;
  const rShoulder = 0.12 * size;

  ctx.beginPath();
  ctx.moveTo(X(bl[0]), Y(bl[1]));
  ctx.arcTo(X(lSh[0]), Y(lSh[1]), X(apex[0]), Y(apex[1]), rShoulder);
  ctx.arcTo(X(apex[0]), Y(apex[1]), X(rSh[0]), Y(rSh[1]), rApex);
  ctx.arcTo(X(rSh[0]), Y(rSh[1]), X(br[0]), Y(br[1]), rShoulder);
  ctx.lineTo(X(br[0]), Y(br[1]));
  // Open bottom rim (a separate sub-path).
  ctx.moveTo(X(0.233), Y(0.463));
  ctx.ellipse(X(0), Y(0.463), 0.233 * size, 0.036 * size, 0, 0, Math.PI * 2);
}

function drawShapePath(ctx: CanvasRenderingContext2D, shape: ShapeKind, cx: number, cy: number, size: number) {
  if (shape === "star") starPath(ctx, cx, cy, size);
  else if (shape === "cloud") cloudPath(ctx, cx, cy, size);
  else if (shape === "lantern") lanternPath(ctx, cx, cy, size);
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

/**
 * Vertical offset (fraction of size) so text sits at the visual middle of each
 * shape. Heart: derived from the actual path (visual span 0.08..0.99 of size,
 * centroid 0.416), +0.04 puts the label at ~50% of the heart's height where
 * it is ~0.88*size wide. Lantern: body centroid sits a little above the middle.
 */
function textOffsetForShape(shape: ShapeKind): number {
  if (shape === "heart") return 0.04;
  if (shape === "lantern") return -0.03;
  return 0;
}

/** Share of `size` the label may use in width, per shape. */
function textWidthFactor(shape: ShapeKind): number {
  if (shape === "lantern") return 0.55;
  if (shape === "cloud") return 0.62;
  if (shape === "star") return 0.55;
  return 0.68;
}

/** Share of `size` the label block may use in height, per shape. */
function textHeightFactor(shape: ShapeKind): number {
  if (shape === "lantern") return 0.48;
  if (shape === "heart") return 0.5;
  if (shape === "cloud") return 0.4;
  return 0.38; // star
}

const MAX_LABEL_LINES = 4;

/** Greedy wrap by character (works for CJK and Latin), honouring explicit line breaks. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const ch of Array.from(para)) {
      if (cur && ctx.measureText(cur + ch).width > maxWidth) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    lines.push(cur);
  }
  return lines;
}

/**
 * Fits a label inside a shape. Short words stay on one line (shrinking a
 * little if needed); longer text wraps onto several lines, shrinking until the
 * block fits. Only if it still can't fit at the minimum size is it cut off
 * with "…".
 */
function layoutLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  startSize: number,
): { size: number; lines: string[] } {
  const minSize = 9;
  const setFont = (n: number) => {
    ctx.font = `700 ${n}px ${FONT_STACK}`;
  };
  const start = Math.max(minSize, Math.round(startSize));

  // 1) Single line, if it stays reasonably large.
  if (!text.includes("\n")) {
    let n = start;
    setFont(n);
    while (n > minSize && ctx.measureText(text).width > maxWidth) {
      n -= 1;
      setFont(n);
    }
    if (ctx.measureText(text).width <= maxWidth && n >= startSize * 0.55) {
      return { size: n, lines: [text] };
    }
  }

  // 2) Wrap, shrinking until the block fits.
  for (let n = start; n >= minSize; n -= 1) {
    setFont(n);
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= MAX_LABEL_LINES && lines.length * n * 1.18 <= maxHeight) {
      return { size: n, lines };
    }
  }

  // 3) Still too long: smallest size, as many lines as fit, ellipsis on the last.
  setFont(minSize);
  const all = wrapText(ctx, text, maxWidth);
  const fit = Math.max(1, Math.min(MAX_LABEL_LINES, Math.floor(maxHeight / (minSize * 1.18))));
  const lines = all.slice(0, fit);
  if (all.length > fit) {
    let last = lines[fit - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[fit - 1] = `${last}…`;
  }
  return { size: minSize, lines };
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
      outerInside = await getMaskInsideMap(mask.dataUrl, width, height, maskMargin(width, height));
      if (token !== renderToken) return;
      await paintMaskBackground(canvas, mask.dataUrl, palette.background, maskMargin(width, height));
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
          // Sample the centre plus a ring (diagonals included) so no part of
          // the shape or its glow can poke into blocked artwork.
          const ringR = radius * 1.02;
          const corners: [number, number][] = [[cx, cy]];
          for (let k = 0; k < 16; k++) {
            const ang = (Math.PI * 2 * k) / 16;
            corners.push([cx + Math.cos(ang) * ringR, cy + Math.sin(ang) * ringR]);
          }
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
    const { size: fontPx, lines } = layoutLabel(
      ctx,
      h.word,
      h.size * textWidthFactor(shape),
      h.size * textHeightFactor(shape),
      h.size * 0.24,
    );
    ctx.font = `700 ${fontPx}px ${FONT_STACK}`;
    const lineH = fontPx * 1.18;
    const centerY = h.y + h.size * textOffsetForShape(shape);
    const firstY = centerY - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, li) => ctx.fillText(line, h.x, firstY + li * lineH));
    ctx.restore();
  }
  // Words that never found room after the minimum scale are silently
  // dropped (lowest-frequency first, since entries are sorted by weight) —
  // an extreme edge case only hit when the mask area is tiny.
}
