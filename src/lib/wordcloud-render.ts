import type { Palette } from "./wordcloud-core";

export type MaskSource = { dataUrl: string } | null;

function hexToRgb(hex: string): [number, number, number] {
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
async function paintMask(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  background: string,
): Promise<void> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("mask_load_failed"));
    image.src = dataUrl;
  });

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = (canvas.width - w) / 2;
  const dy = (canvas.height - h) / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, dx, dy, w, h);

  const [br, bg, bb] = hexToRgb(background);
  const nr = br > 8 ? br - 4 : br + 4;
  const ng = bg > 8 ? bg - 4 : bg + 4;
  const nb = bb > 8 ? bb - 4 : bb + 4;

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3]!;
    const luminance = (px[i]! * 299 + px[i + 1]! * 587 + px[i + 2]! * 114) / 1000;
    // Inside the shape = opaque and dark → free space for words.
    const inside = alpha > 128 && luminance < 128;
    px[i] = inside ? br : nr;
    px[i + 1] = inside ? bg : ng;
    px[i + 2] = inside ? bb : nb;
    px[i + 3] = 255;
  }
  ctx.putImageData(frame, 0, 0);
}

export type RenderOptions = {
  canvas: HTMLCanvasElement;
  counts: Record<string, number>;
  palette: Palette;
  mask: MaskSource;
  rotate: boolean;
  maxWords?: number;
};

let renderToken = 0;

export async function renderWordCloud({
  canvas,
  counts,
  palette,
  mask,
  rotate,
  maxWords = 220,
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

  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords);

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
    await paintMask(canvas, mask.dataUrl, palette.background);
    if (token !== renderToken) return;
  } else {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

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

  WordCloud(canvas, {
    list: entries,
    gridSize: Math.max(4, Math.round((base / 1000) * 10)),
    weightFactor,
    fontFamily: '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif',
    fontWeight: "700",
    color: () => palette.colors[colorIndex++ % palette.colors.length]!,
    backgroundColor: palette.background,
    clearCanvas: !mask,
    rotateRatio: rotate ? 0.35 : 0,
    rotationSteps: 2,
    minRotation: -Math.PI / 12,
    maxRotation: Math.PI / 12,
    shrinkToFit: true,
    drawOutOfBound: false,
  });
}
