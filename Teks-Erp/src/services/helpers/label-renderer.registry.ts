// =============================================================================
// Etiket render driver registry — yazıcı diline göre çıktı seç
// =============================================================================
// 4 dil de hazır: RASTER_HTML (HTML hattı, fiziksel baskı bugün OS-sürücüyle), PPLA
// (Argox/Datamax-DPL), PPLB (Eltron/EPL2), ZPL (Zebra) — komut ÜRETİMİ gerçek;
// ham gönderim Faz-2 (printer-transport simüle). Dil seçimi: global ayar
// `label.printerLanguage` (default PPLA) + istasyon yazıcı modeli (PrinterModel.language)
// override. Bilinmeyen/eksik driver → RASTER_HTML failsafe.
// =============================================================================

import { PrinterLanguage, type LabelTemplate } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import { buildRollLabelHtml } from "./label-html.helper";
import { buildRollLabelPpla } from "./label-ppla.helper";
import { buildRollLabelPplb } from "./label-pplb.helper";
import { buildRollLabelZpl } from "./label-zpl.helper";

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
  PPLA: (i) => buildRollLabelPpla({ payload: i.payload, format: i.format, copies: i.copies, template: i.template }),
  PPLB: (i) => buildRollLabelPplb({ payload: i.payload, format: i.format, copies: i.copies, template: i.template }),
  ZPL: (i) => buildRollLabelZpl({ payload: i.payload, format: i.format, copies: i.copies, template: i.template }),
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
