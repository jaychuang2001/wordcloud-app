import type { Palette } from "./wordcloud-core";
import {
  computeMaskInsideMap,
  hexToRgb,
  loadMaskImage,
  paintMaskBackground,
} from "./wordcloud-render";
import type { MaskSource } from "./wordcloud-render";

export type { MaskSource };

export type HeartCloudOptions = {
  canvas: HTMLCanvasElement;
  counts: Record<string, number>;
  palette: Palette;
  mask: MaskSource;
  maxHearts?: number;
};

const FONT_STACK = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
const REDS = ["#c81e1e", "#e11d2e", "#b91c1c", "#ef4444", "#991b1b", "#f43f5e", "#dc2626"];

/** A classic ❤ outline, centered horizontally at cx, spanning [cyTop, cyTop+size] vertically. */
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

/** Synchronous, vector-drawn heart occupancy map for a square canvas of `size` px. */
function heartInsideMap(size: number): Uint8Array {
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const octx = off.getContext("2d", { willReadFrequently: true });
  const inside = new Uint8Array(size * size);
  if (!octx) return inside;

  const drawSize = size * 0.94;
  const offset = (size - drawSize) / 2;
  octx.fillStyle = "#000000";
  heartPath(octx, size / 2, offset, drawSize);
  octx.fill();

  const frame = octx.getImageData(0, 0, size, size);
  const px = frame.data;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    inside[p] = px[i + 3]! > 128 ? 1 : 0;
  }
  return inside;
}

/** Paints the wordcloud2 "free space" trick (inside vs. near-identical outside colour). */
function paintInsideBackground(canvas: HTMLCanvasElement, inside: Uint8Array, background: string) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const [br, bg, bb] = hexToRgb(background);
  const nr = br > 8 ? br - 4 : br + 4;
  const ng = bg > 8 ? bg - 4 : bg + 4;
  const nb = bb > 8 ? bb - 4 : bb + 4;

  const frame = ctx.createImageData(canvas.width, canvas.height);
  const px = frame.data;
  for (let p = 0, i = 0; p < inside.length; p++, i += 4) {
    const isIn = inside[p] === 1;
    px[i] = isIn ? br : nr;
    px[i + 1] = isIn ? bg : ng;
    px[i + 2] = isIn ? bb : nb;
    px[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
}

function shadeColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const delta = (Math.random() - 0.5) * 40;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v + delta)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

type WordCloudFn = (el: HTMLElement, options: Record<string, unknown>) => void;
let wordCloudPromise: Promise<WordCloudFn> | null = null;
async function getWordCloud(): Promise<WordCloudFn> {
  if (!wordCloudPromise) {
    wordCloudPromise = import("wordcloud").then((mod) => (mod.default ?? mod) as WordCloudFn);
  }
  return wordCloudPromise;
}

/** Fills the mini canvas entirely with repeats of a single word at shrinking sizes. */
function runMiniHeartCloud(
  canvas: HTMLCanvasElement,
  WordCloud: WordCloudFn,
  word: string,
  weight: number,
  color: string,
  background: string,
): Promise<void> {
  const ratios = [1, 0.76, 0.58, 0.44, 0.34, 0.26, 0.2, 0.15, 0.11];
  const list: [string, number][] = ratios.map((r) => [word, Math.max(1, weight * r)]);

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      canvas.removeEventListener("wordcloudstop", finish);
      resolve();
    };
    canvas.addEventListener("wordcloudstop", finish, { once: true });
    WordCloud(canvas, {
      list,
      gridSize: Math.max(2, Math.round(canvas.width / 90)),
      weightFactor: (w: number) => Math.max(6, Math.sqrt(w / list[0]![1]) * canvas.width * 0.4),
      fontFamily: FONT_STACK,
      fontWeight: "700",
      color: () => shadeColor(color),
      backgroundColor: background,
      clearCanvas: false,
      rotateRatio: 0.25,
      rotationSteps: 2,
      minRotation: -Math.PI / 10,
      maxRotation: Math.PI / 10,
      shrinkToFit: true,
      drawOutOfBound: false,
    });
    // Safety net in case wordcloudstop never fires (e.g. a zero-size canvas).
    setTimeout(finish, 900);
  });
}

type PlacedHeart = { word: string; weight: number; x: number; y: number; size: number };

let renderToken = 0;

/**
 * Renders each distinct word as its own heart-shaped mini word-cloud — the
 * heart's outline is formed purely by that single word repeated at shrinking
 * sizes (no coloured heart card underneath), sized overall by how often the
 * word was submitted. Hearts scatter without overlap inside the uploaded
 * shape mask (or the whole canvas without one). When there isn't room for
 * everyone, all hearts shrink together and placement is retried, same as the
 * classic text cloud's shrink-to-fit behaviour.
 */
export async function renderHeartCloud({
  canvas,
  counts,
  palette,
  mask,
  maxHearts = 40,
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
      const img = await loadMaskImage(mask.dataUrl);
      if (token !== renderToken) return;
      outerInside = computeMaskInsideMap(img, width, height);
      await paintMaskBackground(canvas, mask.dataUrl, palette.background);
      if (token !== renderToken) return;
    } catch {
      outerInside = null;
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

  const maxWeight = entries[0]![1];
  const base = Math.min(width, height);
  const sizeFor = (weight: number) => {
    const ratio = Math.sqrt(weight / maxWeight);
    return Math.max(base * 0.09, Math.min(base * 0.32, ratio * base * 0.3));
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
          return Math.hypot(dx, dy) < (h.size * 0.58 + radius) * 0.9;
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

  const WordCloud = await getWordCloud();
  if (token !== renderToken) return;

  for (let i = 0; i < layout.placed.length; i++) {
    const h = layout.placed[i]!;
    const cellSize = Math.max(24, Math.round(h.size));
    const off = document.createElement("canvas");
    off.width = cellSize;
    off.height = cellSize;
    const inside = heartInsideMap(cellSize);
    paintInsideBackground(off, inside, palette.background);

    const color = REDS[i % REDS.length]!;
    await runMiniHeartCloud(off, WordCloud, h.word, h.weight, color, palette.background);
    if (token !== renderToken) return;

    ctx.drawImage(off, h.x - cellSize / 2, h.y - cellSize / 2, cellSize, cellSize);
  }
  // Words that never found room after the minimum scale are silently
  // dropped (lowest-frequency first, since entries are sorted by weight) —
  // an extreme edge case only hit when the mask area is tiny.
}
