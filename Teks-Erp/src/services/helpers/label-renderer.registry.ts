// =============================================================================
// Etiket render driver registry — yazıcı diline göre çıktı seç
// =============================================================================
// 4 dil de hazır: RASTER_HTML (HTML hattı, fiziksel baskı bugün OS-sürücüyle), PPLA
// (Argox/Datamax-DPL), PPLB (Eltron/EPL2), ZPL (Zebra) — komut ÜRETİMİ gerçek;
// ham gönderim Faz-2 (printer-transport simüle). Dil seçimi: cihaz kaydı
// `languageOverride` (cihaz yoksa RASTER_HTML — global dil ayarı kaldırıldı).
// Bilinmeyen/eksik driver → RASTER_HTML failsafe.
// =============================================================================

import { PrinterLanguage, type LabelTemplate, type LabelTemplateVariant } from "@prisma/client";
import type { LabelPayload } from "../label.service";
import type { ResolvedLabelFormat } from "./label-format.resolver";
import { buildRollLabelHtml } from "./label-html.helper";
import { buildRollLabelPpla } from "./label-ppla.helper";
import { buildRollLabelPplb } from "./label-pplb.helper";
import { buildRollLabelZpl } from "./label-zpl.helper";
import { applyRawCode, readTemplateRawCode } from "./label-rawcode";
import { emitCanvasNative } from "./label-canvas-native.helper";
import { buildCanvasLabelHtml } from "./label-canvas-html.helper";
import { readCanvasLayout } from "../../config/label-elements";

export interface LabelRenderInput {
  payload: LabelPayload;
  template: LabelTemplate | null;
  /** Seçili boyut varyantı (kanvas yerleşimi) — null/eksik → akış-modeli (dual-mode). */
  variant?: LabelTemplateVariant | null;
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

/** Yazıcı diline göre etiketi render et. Driver yoksa RASTER_HTML'e düşer (failsafe).
 *  Sıra: rawCode (dolu dil HER ŞEYİ ezer) > varyant kanvası > akış-modeli (dual-mode
 *  — varyantı olmayan/henüz dönüştürülmemiş şablonlar) > şablonsuz fallback. */
export function renderLabel(language: PrinterLanguage, input: LabelRenderInput): RenderedLabel {
  const effective = RENDERERS[language] ? language : PrinterLanguage.RASTER_HTML;
  // Uzman override: şablonda bu dil için raw-code varsa otomatik üretim yerine onu
  // kullan ({{key}} yer-tutucuları payload'dan doldurulur). Yoksa generator çalışır.
  const raw = readTemplateRawCode(input.template?.rawCode, effective);
  if (raw) {
    let content = applyRawCode(raw, input.payload, effective, { barcodeSvg: input.barcodeSvg, qrSvg: input.qrSvg });
    // Native yazıcılar (PPLA/PPLB/ZPL) komut satırlarını CR/LF ile ayırır — otomatik
    // üretici CRLF verir + SON komutu da CRLF ile sonlandırır. Kullanıcı LF yapıştırsa
    // ya da sonda satır sonu bırakmasa da normalize et; yoksa son komut (P1=bas)
    // sonlanmaz → "veri yazıcıya gider ama BASMAZ" olur.
    if (effective !== PrinterLanguage.RASTER_HTML) {
      content = content.replace(/\r?\n/g, "\r\n");
      if (!content.endsWith("\r\n")) content += "\r\n";
    }
    return { language: effective, content, contentType: CONTENT_TYPES[effective] };
  }

  // Kanvas yolu: seçili varyantın eleman yerleşimi (Etiket Stüdyosu v2).
  const layout = input.variant ? readCanvasLayout(input.variant.elements) : null;
  if (layout) {
    const content =
      effective === PrinterLanguage.RASTER_HTML
        ? buildCanvasLabelHtml({
            payload: input.payload,
            format: input.format,
            copies: input.copies,
            layout,
            barcodeSvg: input.barcodeSvg,
            qrSvg: input.qrSvg,
          })
        : emitCanvasNative(effective as "PPLA" | "PPLB" | "ZPL", {
            payload: input.payload,
            format: input.format,
            copies: input.copies,
            layout,
          });
    return { language: effective, content, contentType: CONTENT_TYPES[effective] };
  }

  return {
    language: effective,
    content: RENDERERS[effective]!(input),
    contentType: CONTENT_TYPES[effective],
  };
}
