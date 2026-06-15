// =============================================================================
// Etiket render driver registry — yazıcı diline göre çıktı seç
// =============================================================================
// Faz-1: RASTER_HTML (mevcut HTML hattı, fiziksel baskı bugün çalışır) + PPLA
// (Argox native komut üretimi). PPLB/ZPL gelecekte buraya eklenir; model→dil
// eşlemesi DB'de (PrinterModel.language) → "yazıcı değişse de kodlar kaybolmaz".
// Bilinmeyen/eksik driver → RASTER_HTML failsafe.
// =============================================================================

import { PrinterLanguage, type LabelTemplate } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import { buildRollLabelHtml } from "./label-html.helper";
import { buildRollLabelPpla } from "./label-ppla.helper";

export interface LabelRenderInput {
  payload: LabelPayload;
  template: LabelTemplate | null;
  /** RASTER_HTML için gömülü Code128 SVG (PPLA kullanmaz). */
  barcodeSvg: string;
  /** RASTER_HTML için gömülü QR SVG (PPLA kullanmaz). */
  qrSvg: string;
  copies: number;
  format: ResolvedLabelFormat;
}

export interface RenderedLabel {
  language: PrinterLanguage;
  /** RASTER_HTML → tam HTML; PPLA → native komut string'i. */
  content: string;
  contentType: string;
}

type Renderer = (input: LabelRenderInput) => string;

const RENDERERS: Partial<Record<PrinterLanguage, Renderer>> = {
  RASTER_HTML: (i) =>
    buildRollLabelHtml({
      payload: i.payload,
      template: i.template,
      barcodeSvg: i.barcodeSvg,
      qrSvg: i.qrSvg,
      copies: i.copies,
      format: i.format,
    }),
  PPLA: (i) => buildRollLabelPpla({ payload: i.payload, format: i.format, copies: i.copies }),
  // PPLB / ZPL: gelecek (Faz-2) — eklenince model.language otomatik dispatch eder.
};

const CONTENT_TYPES: Record<PrinterLanguage, string> = {
  RASTER_HTML: "text/html; charset=utf-8",
  PPLA: "text/plain; charset=utf-8",
  PPLB: "text/plain; charset=utf-8",
  ZPL: "text/plain; charset=utf-8",
};

/** Yazıcı diline göre etiketi render et. Driver yoksa RASTER_HTML'e düşer (failsafe). */
export function renderLabel(language: PrinterLanguage, input: LabelRenderInput): RenderedLabel {
  const effective = RENDERERS[language] ? language : PrinterLanguage.RASTER_HTML;
  return {
    language: effective,
    content: RENDERERS[effective]!(input),
    contentType: CONTENT_TYPES[effective],
  };
}
