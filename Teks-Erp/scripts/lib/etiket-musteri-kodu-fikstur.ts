// =============================================================================
// D4-F3 etiket fikstürü — kanvas eleman `source` altın kopyası için ORTAK girdi
// =============================================================================
// Altın (`etiket-musteri-kodu-altin.json`) source alanı DOĞMADAN önceki kodla
// yazıldı; bekçi aynı girdiyi bugünkü kodla çizip sha256'yı kıyaslar.
// =============================================================================
import { createHash } from "node:crypto";
import { emitCanvasPpla, emitCanvasPplb, emitCanvasZpl, type CanvasRenderInput } from "../../src/services/helpers/label-canvas-native.helper";
import { buildCanvasLabelHtml } from "../../src/services/helpers/label-canvas-html.helper";
import { rasterizeCanvasLayout } from "../../src/services/helpers/raster/raster-canvas";
import { renderCode128Svg, renderQrSvg } from "../../src/services/helpers/barcode-svg.helper";
import type { CanvasLayout, LabelElement } from "../../src/config/label-elements";
import type { ResolvedLabelFormat } from "../../src/services/helpers/label-format.resolver";
import type { LabelPayload } from "../../src/types/label.types";

export const FORMAT: ResolvedLabelFormat = {
  widthMm: 100, heightMm: 60, marginMm: 3,
  marginTopMm: 3, marginRightMm: 3, marginBottomMm: 3, marginLeftMm: 3, gapMm: 2,
  orientation: "LANDSCAPE" as never,
  dpi: 203, language: "PPLB" as never, source: "machine" as never,
};

export const PAYLOAD = {
  barcode: "T301026H0042", qualityGrade: "1", widthCm: 150,
  lengthMeters: 120.5, weightKg: 18, itemName: "PERDE TUL", colorName: "KREM",
  customerName: "Gulkesim", batchNumber: "P-9", printedAt: "2026-10-30T09:00:00.000Z",
} as unknown as LabelPayload;

/** Barkod elemanlarını `extra` ile genişletir (ör. `{ source: "ROLL" }`). Yoksa source'suz (eski şablon). */
export function layoutWith(extra: Record<string, unknown> = {}): CanvasLayout {
  const elements = [
    { id: "qr", type: "qr", x: 3, y: 3, scale: 5, ...extra },
    { id: "t1", type: "field", bind: "itemName", x: 30, y: 3, hMm: 4 },
    { id: "t2", type: "field", bind: "barcode", label: "Top", x: 30, y: 10 },
    { id: "bc", type: "code128", x: 3, y: 40, hMm: 9, human: true, ...extra },
  ] as unknown as LabelElement[];
  return { v: 1, elements };
}

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export interface FiveOutputs { html: string; ppla: string; pplb: string; zpl: string; raster: string }

/** Beş render yolu (kanvas HTML · PPLA · PPLB · ZPL · raster) — her biri sha256. */
export async function renderFive(layout: CanvasLayout, payload: LabelPayload = PAYLOAD): Promise<FiveOutputs> {
  const input: CanvasRenderInput = { payload, format: FORMAT, copies: 1, layout };
  const bc = payload.barcode ?? "";
  const html = buildCanvasLabelHtml({ ...input, barcodeSvg: bc ? renderCode128Svg(bc) : "", qrSvg: bc ? renderQrSvg(bc) : "" });
  const bmp = await rasterizeCanvasLayout(input);
  return {
    html: sha(html),
    ppla: sha(emitCanvasPpla(input)),
    pplb: sha(emitCanvasPplb(input)),
    zpl: sha(await emitCanvasZpl(input)),
    raster: sha(bmp.data),
  };
}

/** Ham çıktılar (içerik kontrolü için). */
export async function renderRaw(layout: CanvasLayout, payload: LabelPayload): Promise<{ html: string; ppla: string; pplb: string; zpl: string }> {
  const input: CanvasRenderInput = { payload, format: FORMAT, copies: 1, layout };
  const bc = payload.barcode ?? "";
  return {
    html: buildCanvasLabelHtml({ ...input, barcodeSvg: bc ? renderCode128Svg(bc) : "", qrSvg: bc ? renderQrSvg(bc) : "" }),
    ppla: emitCanvasPpla(input),
    pplb: emitCanvasPplb(input),
    zpl: await emitCanvasZpl(input),
  };
}
