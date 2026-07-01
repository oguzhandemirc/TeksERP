// =============================================================================
// Uzman raw-code override — etiket düzeni başına dil-bazlı ham kod ikamesi
// =============================================================================
// LabelTemplate.rawCode = { PPLA?, PPLB?, ZPL?, RASTER_HTML? }. Bir dil için doluysa
// renderLabel otomatik üretim yerine bu kodu basar; {{key}} yer-tutucuları payload
// değeriyle doldurulur (anahtarlar label-fields kataloğu: barcode/itemName/customerName…).
// Ek: {{barcodeSvg}}/{{qrSvg}} (HTML için ham SVG). Bilinmeyen anahtar → boş string.
// =============================================================================
import bwipjs from "bwip-js";
import { PrinterLanguage, type LabelKind } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import { fieldDisplayValue } from "./label-field-values";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./native-preview";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** {{key}} → payload görüntü değeri. opts ile HTML için {{barcodeSvg}}/{{qrSvg}}. */
export function applyRawCode(
  raw: string,
  payload: LabelPayload,
  opts?: { barcodeSvg?: string; qrSvg?: string },
): string {
  return raw.replace(PLACEHOLDER_RE, (_m, key: string) => {
    if (key === "barcodeSvg") return opts?.barcodeSvg ?? "";
    if (key === "qrSvg") return opts?.qrSvg ?? "";
    return fieldDisplayValue(payload, key).value;
  });
}

/** Şablonun rawCode JSON'undan bir dil için kodu oku (boş/yok → null). */
export function readTemplateRawCode(rawCode: unknown, language: PrinterLanguage): string | null {
  if (!rawCode || typeof rawCode !== "object") return null;
  const v = (rawCode as Record<string, unknown>)[language];
  return typeof v === "string" && v.trim() ? v : null;
}

const PREVIEW_CONTENT_TYPE: Record<PrinterLanguage, string> = {
  RASTER_HTML: "text/html; charset=utf-8",
  PPLA: "text/plain; charset=utf-8",
  PPLB: "text/plain; charset=utf-8",
  ZPL: "text/plain; charset=utf-8",
};

/** Editör önizlemesi: sahte payload + raw-code → ikame edilmiş çıktı (text/html). */
export function buildRawCodePreview(
  kind: LabelKind,
  language: PrinterLanguage,
  code: string,
): { content: string; contentType: string } {
  const payload = mockPayload(kind);
  const opts =
    language === PrinterLanguage.RASTER_HTML
      ? {
          barcodeSvg: bwipjs.toSVG({ bcid: "code128", text: payload.barcode, scale: 3, height: 10, includetext: false, backgroundcolor: "FFFFFF" }),
          qrSvg: bwipjs.toSVG({ bcid: "qrcode", text: payload.barcode, scale: 3, backgroundcolor: "FFFFFF" }),
        }
      : undefined;
  const filled = applyRawCode(code, payload, opts);
  // Native dil (PPLB) → gerçek komutları görsele çevir (editör önizlemesi = baskı).
  // Çizilemezse (geçersiz kod / çizici yok) ham metni göster.
  if (language !== PrinterLanguage.RASTER_HTML) {
    const svg = renderNativePreviewSvg(language, filled.replace(/\r?\n/g, "\r\n"));
    if (svg) return { content: svgToPreviewHtml(svg), contentType: "text/html; charset=utf-8" };
  }
  return { content: filled, contentType: PREVIEW_CONTENT_TYPE[language] };
}

function mockPayload(kind: LabelKind): LabelPayload {
  return {
    rollId: "preview", barcode: "TR-2026-05-26-R0123", status: "STOCK", qualityGrade: "1. Kalite",
    widthCm: 152, lengthMeters: 47.5, weightKg: 14.8, markedForKartela: true,
    itemCode: "PA-60S", itemName: "Cotton Lining 60s", itemNameDefault: "Pamuk Astar 60s", itemNameSource: "OVERRIDE",
    colorCode: "BJ", colorName: "Beige", colorNameDefault: "Bej", colorNameSource: "OVERRIDE",
    customerName: "Demo Tekstil A.S.", customerId: "preview", orderNumber: "SIP-2026-00123", orderLineId: "preview",
    batchNumber: "PRT-A24", printedAt: new Date().toISOString(),
    kind, cardNumber: "SW-2026-05-0042", lengthCm: 30, parentRollBarcode: "TR-2026-05-26-R0123",
  } as LabelPayload;
}
