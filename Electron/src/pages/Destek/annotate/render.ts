// Şekilleri bir 2B bağlama çizer. Ekrandaki önizleme ve PNG çıktısı AYNI fonksiyonu kullanır —
// "ekranda gördüğüm" ile "giden dosya" ayrışamaz.
import { fitWithin, rectFrom, type LineShape, type PathShape, type Shape, type Snapshot } from "./model";

/** Çizimin kullandığı bağlam yüzeyi (test sahte bağlamla koşar). */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "fill"
  | "fillRect"
  | "strokeRect"
  | "fillText"
  | "drawImage"
  | "translate"
  | "scale"
  | "closePath"
  | "strokeStyle"
  | "fillStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "globalAlpha"
  | "font"
  | "textBaseline"
>;

const HIGHLIGHT_ALPHA = 0.35;
/** Karartma kutusu DOLU ve opaktır: altındaki piksel çıktıya hiçbir biçimde sızmaz. */
const REDACT_COLOR = "#111111";

function drawPolyline(ctx: DrawContext, shape: PathShape): void {
  const [first, ...rest] = shape.points;
  if (!first) return;
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineCap = shape.kind === "highlight" ? "square" : "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = shape.kind === "highlight" ? shape.width * 5 : shape.width;
  if (shape.kind === "highlight") ctx.globalAlpha = HIGHLIGHT_ALPHA;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (rest.length === 0) ctx.lineTo(first.x + 0.1, first.y + 0.1);
  for (const p of rest) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

function drawArrow(ctx: DrawContext, shape: LineShape): void {
  const { from, to, width } = shape;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(12, width * 4);
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x - Math.cos(angle) * head * 0.6, to.y - Math.sin(angle) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 7), to.y - head * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 7), to.y - head * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawShape(ctx: DrawContext, shape: Shape): void {
  switch (shape.kind) {
    case "pen":
    case "highlight":
      return drawPolyline(ctx, shape);
    case "arrow":
      return drawArrow(ctx, shape);
    case "rect":
    case "redact": {
      const r = rectFrom(shape.from, shape.to);
      ctx.save();
      if (shape.kind === "redact") {
        ctx.fillStyle = REDACT_COLOR;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      } else {
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
      ctx.restore();
      return;
    }
    case "text":
      ctx.save();
      ctx.fillStyle = shape.color;
      ctx.font = `600 ${shape.size}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(shape.text, shape.at.x, shape.at.y);
      ctx.restore();
      return;
  }
}

/** Görüntü + bütün şekiller (kırpma uygulanmadan; kırpma yalnız çıktıda kesilir). */
export function drawScene(ctx: DrawContext, image: CanvasImageSource, snapshot: Snapshot): void {
  ctx.drawImage(image, 0, 0);
  for (const s of snapshot.shapes) drawShape(ctx, s);
}

export interface ExportInput {
  image: CanvasImageSource;
  width: number;
  height: number;
  snapshot: Snapshot;
  maxEdge?: number;
}

/**
 * Çıktı PNG (düz base64): kırpma alanı kesilir, uzun kenar ≤ `maxEdge` (varsayılan 1920) olacak şekilde küçültülür.
 * Bağlam alınamazsa (ör. tuval desteklenmiyor) `null`.
 */
export function exportPng(input: ExportInput, doc: Document = document): { base64: string; width: number; height: number } | null {
  const area = input.snapshot.crop ?? { x: 0, y: 0, w: input.width, h: input.height };
  const out = fitWithin(area.w, area.h, input.maxEdge ?? 1920);
  const canvas = doc.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(out.scale, out.scale);
  ctx.translate(-area.x, -area.y);
  drawScene(ctx, input.image, input.snapshot);
  const url = canvas.toDataURL("image/png");
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  return { base64: url.slice(comma + 1), width: out.width, height: out.height };
}
