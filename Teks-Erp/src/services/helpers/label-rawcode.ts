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
import type { LabelPayload } from "../../types/label.types";
import { fieldDisplayValue } from "./label-field-values";
import { renderNativePreviewSvg, svgToPreviewHtml } from "./native-preview";
import { escapeHtml } from "./label-html.shared";
import { cleanCtl } from "./native-label.shared";

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * F186: Gömülen ALAN DEĞERİNİ hedef dile göre kaçır/temizle — komut çerçevesine
 * (admin'in yazdığı raw kod) DOKUNMAZ, yalnız payload veri slotlarına uygulanır.
 * Normal generator yolundaki cleanCtl/eplData/zplData/escapeHtml ile BİREBİR aynı
 * davranış → meşru çıktı değişmez; yalnız kullanıcı-kontrollü metnin komut/markup
 * enjeksiyonu (native frame bozulması + HTML injection) kapanır.
 */
function sanitizeFieldValue(value: string, language: PrinterLanguage): string {
  switch (language) {
    case PrinterLanguage.RASTER_HTML:
      return escapeHtml(value);
    case PrinterLanguage.PPLB:
      // EPL2 verisi "..." içinde → " veriyi erken kapatır (eplData ile aynı).
      return cleanCtl(value).replace(/"/g, "'");
    case PrinterLanguage.ZPL:
      // ^ ve ~ ZPL komut öneki → veriden ayıkla (zplData ile aynı).
      return cleanCtl(value).replace(/[\^~]/g, " ");
    case PrinterLanguage.PPLA:
    default:
      // DPL metin kaydı konumsal (tırnaksız) → yalnız kontrol baytları + ASCII fold.
      return cleanCtl(value);
  }
}

/** {{key}} → payload görüntü değeri (dile göre sanitize). opts ile HTML {{barcodeSvg}}/{{qrSvg}}. */
export function applyRawCode(
  raw: string,
  payload: LabelPayload,
  language: PrinterLanguage,
  opts?: { barcodeSvg?: string; qrSvg?: string },
): string {
  return raw.replace(PLACEHOLDER_RE, (_m, key: string) => {
    // barcodeSvg/qrSvg = güvenilir sistem SVG'si → HAM bırak (escape SVG'yi bozar).
    if (key === "barcodeSvg") return opts?.barcodeSvg ?? "";
    if (key === "qrSvg") return opts?.qrSvg ?? "";
    return sanitizeFieldValue(fieldDisplayValue(payload, key).value, language);
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
  const filled = applyRawCode(code, payload, language, opts);
  // Native dil (PPLB) → gerçek komutları görsele çevir (editör önizlemesi = baskı).
  // Çizilemezse (geçersiz kod / çizici yok) ham metni göster.
  if (language !== PrinterLanguage.RASTER_HTML) {
    const svg = renderNativePreviewSvg(language, filled.replace(/\r?\n/g, "\r\n"));
    if (svg) return { content: svgToPreviewHtml(svg), contentType: "text/html; charset=utf-8" };
  }
  return { content: filled, contentType: PREVIEW_CONTENT_TYPE[language] };
}

export function mockPayload(kind: LabelKind): LabelPayload {
  const base = {
    rollId: "preview", barcode: "T120726F0001", status: "STOCK", qualityGrade: "1. Kalite",
    widthCm: 152, lengthMeters: 47.5, weightKg: 14.8, markedForKartela: true,
    itemCode: "PA-60S", itemName: "Cotton Lining 60s", itemNameDefault: "Pamuk Astar 60s", itemNameSource: "OVERRIDE",
    colorCode: "BJ", colorName: "Beige", colorNameDefault: "Bej", colorNameSource: "OVERRIDE",
    customerName: "Demo Tekstil A.S.", customerId: "preview", orderNumber: "SIP1207260001", orderLineId: "preview",
    batchNumber: "P1207261", workOrderNumber: "IE1207260001", printedAt: new Date().toISOString(),
    // KAT — katalog KODU ("2-KAT"/"6-KAT"/"TUP"), ad değil (bkz. LabelPayload.foldType).
    foldType: "2-KAT",
    kind, cardNumber: "KRT1207260001", lengthCm: 30, parentRollBarcode: "T120726H0001",
  };
  // SACK dalı ŞART: stüdyo önizlemesi bu payload'ı kullanır. Çuval alanları
  // doldurulmazsa tasarımcı alanı sürükler, önizlemede boş görür ve "alan
  // çalışmıyor" sanar (present:false → eleman atlanır).
  // `LabelKind` bu dosyada `import type` ile geldiği için değer olarak kullanılamaz
  // → literal karşılaştırma (label-flow-to-canvas.ts ile aynı desen).
  if (kind === ("SACK" as LabelKind)) {
    return {
      ...base,
      barcode: "CV1207260001",
      sackNo: "CV1207260001",
      rollCount: 12,
      lengthMeters: 1284.5,
      weightKg: 312.4,
      branchName: "Merkez Şube",
      sackNote: "Ölçü şüpheli — müşteri kontrol etsin",
      // Çuvalda ürün/renk YOK (karışık içerik) — önizleme de bunu yansıtsın.
      itemCode: "", itemName: "", itemNameDefault: "",
      colorCode: null, colorName: null, colorNameDefault: null, colorNameSource: null,
      qualityGrade: "", widthCm: null, markedForKartela: false,
    } as LabelPayload;
  }
  return base as LabelPayload;
}
