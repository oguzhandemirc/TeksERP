// =============================================================================
// TeksERP - Etiket Kanvas Eleman Modeli (Etiket Stüdyosu v2 — source of truth)
// =============================================================================
// Serbest-konum şablon yerleşimi: LabelTemplateVariant.elements JSON'unun tip
// tanımı + dil-yetenek (degrade) matrisi + yapısal doğrulama. Backend emit
// (label-canvas-native/html.helper) ve Electron editör rozeti AYNI matristen
// beslenir — "bu eleman PPLA'da basılmaz" bilgisinin tek kaynağı burası.
//
// Koordinat sistemi: mm, tuval sol-üst orijin, y aşağı artar. Tuval boyutu
// varyanttan (widthMm×heightMm); MEDYA boyutu baskı anında format profilinden
// gelir (eşleşen varyant seçilir; fallback'te taşan elemanı yazıcı kırpar —
// çakışma/taşma sorumluluğu EDİTÖRDE, emit katmanı lint yapmaz).
//
// NOT (TDZ kuralı): modül üst kapsamında Prisma enum ÜYESİ deref YASAK —
// dil anahtarları string literal + tip `as` ile korunur.
// =============================================================================

import type { FontSize } from "./label-fields";

/** Kanvas şema sürümü — LabelTemplateVariant.elements = { v: 1, elements: [...] }. */
export const CANVAS_SCHEMA_VERSION = 1;

export type CanvasRotation = 0 | 90 | 180 | 270;

export type LabelElementType =
  | "field"        // veri-bağlı metin (bind → fieldDisplayValue; label doluysa "Etiket: değer")
  | "text"         // statik metin (aynen basılır)
  | "qr"           // QR kod (veri: payload.barcode)
  | "code128"      // 1D Code128 (veri: payload.barcode)
  | "line"         // dolu siyah çizgi/kutu — PPLA'da BASILMAZ
  | "box"          // içi boş çerçeve — PPLA'da BASILMAZ
  | "lengthBanner"; // dikey ters metraj bandı (siyah zemin/beyaz değer) — PPLA'da BASILMAZ

interface ElementBase {
  /** Editör kimliği (kararlı; sürükle/seç için). */
  id: string;
  /** mm — tuval sol-üst orijinden. */
  x: number;
  y: number;
}

export interface FieldElement extends ElementBase {
  type: "field";
  /** Birleşik katalog alan anahtarı — değer fieldDisplayValue(payload, bind)'dan.
   *  Bağlamda değeri olmayan alan (present:false) baskıda ATLANIR (boşluk kalır —
   *  mutlak konumda kayma yok). */
  bind: string;
  /** Dolu → "Etiket: değer"; boş/yok → yalnız değer. */
  label?: string;
  /** ESKİ 4-kademe sistem (geri uyum) — hMm doluysa YOK SAYILIR. */
  font?: FontSize;
  /** SERBEST yükseklik (mm, 1-30): ZPL/HTML birebir; PPLA/PPLB en yakın
   *  basılabilir kombinasyon (resolveEplTextStyle — 5 font × çarpanlar). */
  hMm?: number;
  /** Genişlik oranı (0.25-4, 1=doğal): dar/geniş — bitmap'te "ince/kalın" görünüm. */
  wr?: number;
  /** hMm YOKKEN eski anlam (çarpan×2); hMm doluysa yalnız HTML font-weight. */
  bold?: boolean;
  rot?: CanvasRotation;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  /** ESKİ 4-kademe sistem (geri uyum) — hMm doluysa YOK SAYILIR. */
  font?: FontSize;
  /** SERBEST yükseklik (mm) — bkz. FieldElement.hMm. */
  hMm?: number;
  /** Genişlik oranı — bkz. FieldElement.wr. */
  wr?: number;
  bold?: boolean;
  rot?: CanvasRotation;
}

export interface QrElement extends ElementBase {
  type: "qr";
  /** Modül büyütme (dots/modül, 2–15). Yok → 5. Ayak izi qrFootprintDots ile. */
  scale?: number;
}

export interface Code128Element extends ElementBase {
  type: "code128";
  /** Bar yüksekliği (mm). Yok → 9. */
  hMm?: number;
  /** Okunur satır (insan-okur barkod değeri). Yok → true. */
  human?: boolean;
  /** Modül (dar çubuk) kalınlığı — dot (1-4). Yok → 2. Barkod genişliği serbest
   *  ölçü DEĞİLDİR: okunabilirlik için çubuklar tam-sayı dot olmalı; genişletme
   *  bu kademeyle ORANTILI yapılır (her kademe ≈ %50-100 genişletir). */
  mw?: number;
}

export interface LineElement extends ElementBase {
  type: "line";
  wMm: number;
  hMm: number;
}

export interface BoxElement extends ElementBase {
  type: "box";
  wMm: number;
  hMm: number;
  /** Çerçeve kalınlığı (mm). Yok → 0.5. */
  thickMm?: number;
}

export interface LengthBannerElement extends ElementBase {
  type: "lengthBanner";
  /** Bant genişliği (mm). Yok → dil emitter'ının hesapladığı varsayılan. */
  wMm?: number;
  /** Bant boyu (mm). Yok → tuval boyu − 2×y. */
  hMm?: number;
}

export type LabelElement =
  | FieldElement
  | TextElement
  | QrElement
  | Code128Element
  | LineElement
  | BoxElement
  | LengthBannerElement;

export interface CanvasLayout {
  v: number;
  elements: LabelElement[];
}

// =============================================================================
// Dil yetenek (degrade) matrisi — TEK KAYNAK
// =============================================================================
// "ok"   → eleman bu dilde basılır.
// "skip" → eleman bu dilde SESSİZCE atlanır; editör eleman üzerinde
//          "<dil>'de basılmaz" rozeti gösterir (emsal: metraj bandı bugün de
//          PPLA'da basılmıyor — DPL'de güvenilir reverse yok).
type LangKey = "PPLA" | "PPLB" | "ZPL" | "RASTER_HTML";

export const CAPABILITY: Record<LabelElementType, Record<LangKey, "ok" | "skip">> = {
  field:        { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  text:         { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  qr:           { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  code128:      { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  // line/box: DPL font-X kayıtlarıyla PPLA'da da basılır (L=dolu çizgi, B=çerçeve).
  line:         { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  box:          { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  // lengthBanner PPLA'da BASILAMAZ: siyah zemin/beyaz değer TERS-RENK ister;
  // DPL'de güvenilir reverse yok (saha gerçeği — PPLB 'R' / ZPL ^FR var).
  lengthBanner: { PPLA: "skip", PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
};

export function elementSupported(type: LabelElementType, language: string): boolean {
  const row = CAPABILITY[type];
  if (!row) return false;
  return (row[language as LangKey] ?? "skip") === "ok";
}

// =============================================================================
// Yapısal doğrulama (Türkçe mesajlar) — servis katmanı çağırır
// =============================================================================

export const MAX_ELEMENTS = 80;
const FONTS: readonly string[] = ["sm", "md", "lg", "xl"];
const ROTS: readonly number[] = [0, 90, 180, 270];
const TYPES: readonly string[] = ["field", "text", "qr", "code128", "line", "box", "lengthBanner"];
/** Tuval üst sınırı (mm) — makul olmayan koordinat/boyutu erken yakalar. */
const MAX_MM = 500;

export class CanvasValidationError extends Error {}

function bad(msg: string): never {
  throw new CanvasValidationError(msg);
}

function checkMm(v: unknown, what: string, max = MAX_MM): number {
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${what} sayı olmalı`);
  const n = v as number;
  if (n < 0) bad(`${what} negatif olamaz`);
  if (n > max) bad(`${what} en fazla ${max} mm olabilir`);
  return n;
}

/**
 * Kanvas yerleşimini doğrular — { v, elements } şekli + eleman alanları + tuval
 * sınırı (başlangıç noktası tuval içinde olmalı) + en az bir taranabilir alan
 * (QR veya Code128 — fabrika içi takip fiziksel iz ister). Hata → CanvasValidationError
 * (controller/servis AppError.badRequest'e çevirir).
 */
export function validateCanvasLayout(
  raw: unknown,
  canvas: { widthMm: number; heightMm: number },
): CanvasLayout {
  if (!raw || typeof raw !== "object") bad("Yerleşim (elements) nesne olmalı");
  const layout = raw as { v?: unknown; elements?: unknown };
  if (layout.v !== CANVAS_SCHEMA_VERSION) bad(`Yerleşim şema sürümü ${CANVAS_SCHEMA_VERSION} olmalı`);
  if (!Array.isArray(layout.elements)) bad("elements bir dizi olmalı");
  const els = layout.elements as unknown[];
  if (els.length === 0) bad("Tuvalde en az 1 eleman olmalı");
  if (els.length > MAX_ELEMENTS) bad(`En fazla ${MAX_ELEMENTS} eleman olabilir`);

  const seenIds = new Set<string>();
  let scannable = 0;

  for (const rawEl of els) {
    if (!rawEl || typeof rawEl !== "object") bad("Geçersiz eleman nesnesi");
    const el = rawEl as Record<string, unknown>;

    if (typeof el.id !== "string" || el.id.length === 0 || el.id.length > 40) {
      bad("Eleman id zorunlu (1-40 karakter)");
    }
    if (seenIds.has(el.id as string)) bad(`Tekrarlanan eleman id: '${el.id}'`);
    seenIds.add(el.id as string);

    if (typeof el.type !== "string" || !TYPES.includes(el.type)) {
      bad(`Bilinmeyen eleman tipi: '${String(el.type)}'. İzinli: ${TYPES.join(", ")}`);
    }
    const type = el.type as LabelElementType;

    const x = checkMm(el.x, `'${el.id}' x`);
    const y = checkMm(el.y, `'${el.id}' y`);
    // Başlangıç noktası tuval içinde olmalı (taşma lint'i editörde — burada sert sınır
    // yalnız "tümüyle dışarıda" saçmalığını keser).
    if (x > canvas.widthMm) bad(`'${el.id}' x (${x}mm) tuval genişliğini (${canvas.widthMm}mm) aşıyor`);
    if (y > canvas.heightMm) bad(`'${el.id}' y (${y}mm) tuval boyunu (${canvas.heightMm}mm) aşıyor`);

    if (el.font !== undefined && !FONTS.includes(el.font as string)) {
      bad(`'${el.id}' font geçersiz. İzinli: ${FONTS.join(", ")}`);
    }
    // Serbest metin boyutu YALNIZ metin tiplerinde (line/code128'in hMm'i farklı
    // anlamda — kendi case'lerinde doğrulanır).
    if (type === "field" || type === "text") {
      if (el.hMm !== undefined) {
        if (typeof el.hMm !== "number" || !Number.isFinite(el.hMm)) bad(`'${el.id}' hMm sayı olmalı`);
        if ((el.hMm as number) < 1 || (el.hMm as number) > 30) bad(`'${el.id}' hMm 1-30 mm aralığında olmalı`);
      }
      if (el.wr !== undefined) {
        if (typeof el.wr !== "number" || !Number.isFinite(el.wr)) bad(`'${el.id}' wr sayı olmalı`);
        if ((el.wr as number) < 0.25 || (el.wr as number) > 4) bad(`'${el.id}' wr 0.25-4 aralığında olmalı (genişlik oranı)`);
      }
    }
    if (el.rot !== undefined && !ROTS.includes(el.rot as number)) {
      bad(`'${el.id}' rot geçersiz. İzinli: ${ROTS.join(", ")}`);
    }
    if (el.bold !== undefined && typeof el.bold !== "boolean") {
      bad(`'${el.id}' bold boolean olmalı`);
    }

    switch (type) {
      case "field":
        if (typeof el.bind !== "string" || (el.bind as string).length === 0) {
          bad(`'${el.id}' bind (alan anahtarı) zorunlu`);
        }
        if (el.label !== undefined && typeof el.label !== "string") {
          bad(`'${el.id}' label metin olmalı`);
        }
        break;
      case "text":
        if (typeof el.text !== "string" || (el.text as string).length === 0) {
          bad(`'${el.id}' text (statik metin) zorunlu`);
        }
        if ((el.text as string).length > 200) bad(`'${el.id}' text en fazla 200 karakter`);
        break;
      case "qr":
        if (el.scale !== undefined) {
          if (typeof el.scale !== "number" || !Number.isInteger(el.scale)) bad(`'${el.id}' scale tamsayı olmalı`);
          if ((el.scale as number) < 2 || (el.scale as number) > 15) bad(`'${el.id}' scale 2-15 aralığında olmalı`);
        }
        scannable++;
        break;
      case "code128":
        if (el.hMm !== undefined) checkMm(el.hMm, `'${el.id}' hMm`, 100);
        if (el.human !== undefined && typeof el.human !== "boolean") bad(`'${el.id}' human boolean olmalı`);
        if (el.mw !== undefined) {
          if (typeof el.mw !== "number" || !Number.isInteger(el.mw)) bad(`'${el.id}' mw tamsayı olmalı`);
          if ((el.mw as number) < 1 || (el.mw as number) > 4) bad(`'${el.id}' mw 1-4 aralığında olmalı (modül kalınlığı)`);
        }
        scannable++;
        break;
      case "line":
        checkMm(el.wMm, `'${el.id}' wMm`);
        checkMm(el.hMm, `'${el.id}' hMm`);
        break;
      case "box":
        checkMm(el.wMm, `'${el.id}' wMm`);
        checkMm(el.hMm, `'${el.id}' hMm`);
        if (el.thickMm !== undefined) checkMm(el.thickMm, `'${el.id}' thickMm`, 20);
        break;
      case "lengthBanner":
        if (el.wMm !== undefined) checkMm(el.wMm, `'${el.id}' wMm`);
        if (el.hMm !== undefined) checkMm(el.hMm, `'${el.id}' hMm`);
        break;
    }
  }

  if (scannable === 0) {
    bad("Barkod (Code128) veya QR elemanından en az biri olmalı (taranabilir alan zorunlu)");
  }

  return { v: CANVAS_SCHEMA_VERSION, elements: els as LabelElement[] };
}

/** Varyant JSON'ından kanvas yerleşimini oku — geçersiz/boş → null (emit katmanı
 *  akış-modeline düşer; fail-safe). */
export function readCanvasLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const layout = raw as { v?: unknown; elements?: unknown };
  if (layout.v !== CANVAS_SCHEMA_VERSION || !Array.isArray(layout.elements)) return null;
  if (layout.elements.length === 0) return null;
  return { v: CANVAS_SCHEMA_VERSION, elements: layout.elements as LabelElement[] };
}
