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
import { getLabelIcon } from "./label-icons";

/** Kanvas şema sürümü — LabelTemplateVariant.elements = { v: 1, elements: [...] }. */
export const CANVAS_SCHEMA_VERSION = 1;

/** İkon (bakım sembolü) kare kenar varsayılan/sınırları (mm) — Electron
 *  canvas-model.ts ile AYNI değerler (frontend aynası). */
export const ICON_DEFAULT_MM = 8;
export const ICON_MIN_MM = 3;
export const ICON_MAX_MM = 50;

export type CanvasRotation = 0 | 90 | 180 | 270;

/** Metin yatay hizalama — çapa (x) referanslı: left = x'ten sağa, center = x'te ortalı,
 *  right = x'te biter. Çok satırda satırlar birbirine göre hizalanır. Yok → left. */
export type TextAlign = "left" | "center" | "right";

/** Metin harf dönüşümü — Türkçe-duyarlı (i/İ). Yok → dokunma. */
export type TextCase = "upper" | "lower";

export type LabelElementType =
  | "field"        // veri-bağlı metin (bind → fieldDisplayValue; label doluysa "Etiket: değer")
  | "text"         // statik metin (aynen basılır)
  | "qr"           // QR kod (veri: payload.barcode)
  | "code128"      // 1D Code128 (veri: payload.barcode)
  | "line"         // dolu siyah çizgi/kutu — PPLA'da BASILMAZ
  | "box"          // içi boş çerçeve — PPLA'da BASILMAZ
  | "lengthBanner" // dikey ters metraj bandı (siyah zemin/beyaz değer) — PPLA'da BASILMAZ
  | "icon";        // bakım sembolü (label-icons kataloğu) — PPLB GW/ZPL/raster/HTML; PPLA'da BASILMAZ

interface ElementBase {
  /** Editör kimliği (kararlı; sürükle/seç için). */
  id: string;
  /** mm — tuval sol-üst orijinden. */
  x: number;
  y: number;
  /** Grup kimliği (opsiyonel) — aynı groupId'li elemanlar editörde birlikte seçilir/taşınır/
   *  ölçeklenir. JSON'da taşınır; emit/baskı groupId'i YOK SAYAR (yalnız editör kolaylığı). */
  groupId?: string;
  /** Kilitli mi — tuvalde sürükleme/marquee ile yanlışlıkla oynatılmaz (katman listesinden
   *  seçilip açılır). JSON'da taşınır; emit/baskı YOK SAYAR (yalnız editör kolaylığı). */
  locked?: boolean;
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
  /** Yatay hizalama (çapa=x). Yok → left (bugünkü davranış). */
  align?: TextAlign;
  /** Harf dönüşümü (BÜYÜK/küçük). Yok → dokunma. */
  textCase?: TextCase;
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
  /** Yatay hizalama (çapa=x). Yok → left. Çok satırda satırlar birbirine hizalanır. */
  align?: TextAlign;
  /** Harf dönüşümü (BÜYÜK/küçük). Yok → dokunma. */
  textCase?: TextCase;
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
  /** Okunur satır (barkod altı kod) yüksekliği (mm, 1-20) — büyüt/küçült. Yok →
   *  dile-özel küçük varsayılan (bugünkü sabit; bayt-uyum). Dolu → 4 dilde ortak-payda
   *  boyut (metin elemanlarındaki gibi en yakın basılabilir kombinasyon). */
  humanHMm?: number;
  /** Okunur satırı ORTALANMIŞ konumdan kaydırma (mm, ±). Yok → 0 = barkod altında
   *  tam ortalı. Barkoddan bağımsız ince ayar için. */
  humanDx?: number;
  humanDy?: number;
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
  /** Değerin dönüşü (0/90/180/270). Yok → 90 (dikey bant, yukarı okunur). */
  rot?: CanvasRotation;
  /** "m" (metre) birim eki. Yok → true ("230,5m"); false → yalnız sayı. */
  unit?: boolean;
  /** Değer glif yüksekliği (mm, 1-30). Yok → banda otomatik sığdır (bugünkü davranış).
   *  Dolu → metin elemanlarıyla aynı ortak-payda: en yakın basılabilir kombinasyon. */
  glyphHMm?: number;
  /** Değer genişlik oranı (0.25-4, 1=doğal) — dar/geniş; bitmap'te "ince/kalın" görünüm.
   *  Bantta kalınlık BUNUNLA verilir (ters/reverse modda çift-vuruş XOR'lanır → bold yok). */
  wr?: number;
}

export interface IconElement extends ElementBase {
  type: "icon";
  /** Bakım sembolü anahtarı — label-icons kayıt defterinden (getLabelIcon ile çözülür). */
  icon: string;
  /** Kare kenar (mm, 3-50). Yok → 8. width=height=hMm (frontend sözleşmesi). */
  hMm?: number;
  rot?: CanvasRotation;
}

export type LabelElement =
  | FieldElement
  | TextElement
  | QrElement
  | Code128Element
  | LineElement
  | BoxElement
  | LengthBannerElement
  | IconElement;

/** Kağıt kenarından güvenli-alan boşluğu (mm), her kenar ayrı. Editör kılavuzu +
 *  eleman clamp'i için; baskıya DOĞRUDAN yansımaz (elemanlar zaten alan içine
 *  sıkıştırılır → çıktı otomatik uyar). Eksik/sıfır → boşluk yok. */
export interface CanvasPad {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CanvasLayout {
  v: number;
  elements: LabelElement[];
  pad?: CanvasPad;
}

/** Ham pad'i sanitize et — her kenar 0-200mm; hepsi 0 ise undefined (saklanmaz).
 *  Editör kenarları boyuta göre kısıtlar; burada yalnız güvenli aralık zorlanır. */
export function parseCanvasPad(raw: unknown): CanvasPad | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const n = (v: unknown): number => {
    const x = typeof v === "number" && Number.isFinite(v) ? v : 0;
    return Math.max(0, Math.min(200, x));
  };
  const pad = { top: n(p.top), right: n(p.right), bottom: n(p.bottom), left: n(p.left) };
  return pad.top || pad.right || pad.bottom || pad.left ? pad : undefined;
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
  // lengthBanner: PPLA'da ÇERÇEVELİ sürüm basılır (kutu + döndürülmüş siyah değer)
  // — ters-renk (siyah zemin/beyaz değer) DPL'de güvenilmez (saha gerçeği; PPLB
  // 'R' / ZPL ^FR var). Görünüm farkı: PPLB/ZPL/HTML dolgulu, PPLA dolgusuz.
  lengthBanner: { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  // icon: PPLB'de GW (Print Immediate Graphics) inline 1bpp grafik bloğuyla basılır
  // (metin/barkod yine native komut; sadece ikon bitmap — Bluetooth'ta düşük yük).
  // ZPL ^GFA, HTML/raster doğrudan çizimle basar. PPLA (DPL) komut modunda hâlâ skip
  // (DPL grafik kaydı ayrı iş). Fiziksel: PPLB GW aynı komut → raster-envelope-pplb
  // PPLB_RASTER_VERIFIED kill-switch'i emit'i de gate'ler. Electron rozeti AYNI matris.
  icon:         { PPLA: "skip", PPLB: "ok",   ZPL: "ok", RASTER_HTML: "ok" },
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
const TYPES: readonly string[] = ["field", "text", "qr", "code128", "line", "box", "lengthBanner", "icon"];
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
 *
 * requireScannable (varsayılan TRUE — geri uyum): false → taranabilir-alan kuralı
 * ATLANIR. Statik bakım etiketi (yalnız sembol/metin) için: atanmamış havuz şablonu
 * taranabilirsiz kaydedilebilir; ATANMIŞ şablon (bağlam/müşteri/cihaz rotası) her
 * zaman taranabilir kalmalı — karar servis katmanında (parseCanvas) verilir.
 */
export function validateCanvasLayout(
  raw: unknown,
  canvas: { widthMm: number; heightMm: number; requireScannable?: boolean },
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

    if (el.groupId !== undefined && (typeof el.groupId !== "string" || (el.groupId as string).length > 40)) {
      bad(`'${el.id}' groupId metin olmalı (en fazla 40 karakter)`);
    }
    if (el.locked !== undefined && typeof el.locked !== "boolean") {
      bad(`'${el.id}' locked boolean olmalı`);
    }

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
      if (el.align !== undefined && !["left", "center", "right"].includes(el.align as string)) {
        bad(`'${el.id}' align geçersiz. İzinli: left, center, right`);
      }
      if (el.textCase !== undefined && !["upper", "lower"].includes(el.textCase as string)) {
        bad(`'${el.id}' textCase geçersiz. İzinli: upper, lower`);
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
        // Okunur satır boyutu (mm) — metin gibi 1-20 aralığı.
        if (el.humanHMm !== undefined) {
          if (typeof el.humanHMm !== "number" || !Number.isFinite(el.humanHMm)) bad(`'${el.id}' humanHMm sayı olmalı`);
          if ((el.humanHMm as number) < 1 || (el.humanHMm as number) > 20) bad(`'${el.id}' humanHMm 1-20 mm aralığında olmalı`);
        }
        // Okunur satır kaydırması — İŞARETLİ (barkod solundan/üstünden negatif olabilir).
        for (const k of ["humanDx", "humanDy"] as const) {
          const v = el[k];
          if (v !== undefined) {
            if (typeof v !== "number" || !Number.isFinite(v)) bad(`'${el.id}' ${k} sayı olmalı`);
            if (Math.abs(v as number) > MAX_MM) bad(`'${el.id}' ${k} ±${MAX_MM} mm içinde olmalı`);
          }
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
        if (el.unit !== undefined && typeof el.unit !== "boolean") {
          bad(`'${el.id}' unit boolean olmalı`);
        }
        if (el.glyphHMm !== undefined) {
          if (typeof el.glyphHMm !== "number" || !Number.isFinite(el.glyphHMm)) bad(`'${el.id}' glyphHMm sayı olmalı`);
          if ((el.glyphHMm as number) < 1 || (el.glyphHMm as number) > 30) bad(`'${el.id}' glyphHMm 1-30 mm aralığında olmalı`);
        }
        if (el.wr !== undefined) {
          if (typeof el.wr !== "number" || !Number.isFinite(el.wr)) bad(`'${el.id}' wr sayı olmalı`);
          if ((el.wr as number) < 0.25 || (el.wr as number) > 4) bad(`'${el.id}' wr 0.25-4 aralığında olmalı (genişlik oranı)`);
        }
        break;
      case "icon":
        if (typeof el.icon !== "string" || (el.icon as string).length === 0) {
          bad(`'${el.id}' icon (sembol anahtarı) zorunlu`);
        }
        if (!getLabelIcon(el.icon as string)) bad(`Bilinmeyen sembol: '${String(el.icon)}'`);
        if (el.hMm !== undefined) {
          if (typeof el.hMm !== "number" || !Number.isFinite(el.hMm)) bad(`'${el.id}' hMm sayı olmalı`);
          if ((el.hMm as number) < ICON_MIN_MM || (el.hMm as number) > ICON_MAX_MM) {
            bad(`'${el.id}' hMm ${ICON_MIN_MM}-${ICON_MAX_MM} mm aralığında olmalı`);
          }
        }
        break;
    }
  }

  if (scannable === 0 && (canvas.requireScannable ?? true)) {
    bad("Barkod (Code128) veya QR elemanından en az biri olmalı (taranabilir alan zorunlu)");
  }

  // pad KORUNUR (aksi halde her kayıtta silinirdi) — editör güvenli-alan kılavuzu.
  const pad = parseCanvasPad((layout as { pad?: unknown }).pad);
  return { v: CANVAS_SCHEMA_VERSION, elements: els as LabelElement[], ...(pad ? { pad } : {}) };
}

// =============================================================================
// Çok satırlı Sabit Metin (`text`) — render-anı genişletme (5 dil/raster ORTAK)
// =============================================================================
// Emit sanitize (cleanCtl) `\n`'i (0x0A) zaten silerdi → satırlara bölmenin TEK doğru
// yeri burası. `\n` içeren her `text` elemanı, her satır TEK-satır text elemanına açılır;
// y (rot'a dik yönde) satır adımınca kaydırılır. `field` DEĞİL (değeri payload'dan gelir,
// tek satır). Değişiklik yoksa aynı dizi döner (bayt-uyum: tek satırlı şablonlar aynı çıkar).

/** Sabit metin glif yüksekliği (mm) — kademeli font @203dpi (EPL_FONT.h/8); frontend FONT_MM aynası. */
const TEXT_FONT_MM: Record<string, number> = { sm: 1.5, md: 2.0, lg: 2.5, xl: 3.0 };

/** Bir text elemanının satır adımı (mm) = glif yüksekliği × 1.3 (satır aralığı). */
function textLineStepMm(el: TextElement): number {
  const h = el.hMm ?? (TEXT_FONT_MM[el.font ?? "md"] ?? 2.0) * (el.bold ? 2 : 1);
  return h * 1.3;
}

/** `\n` içeren `text` elemanlarını alt alta tek-satır elemanlara genişlet (render öncesi). */
export function expandMultilineText(elements: LabelElement[]): LabelElement[] {
  if (!elements.some((el) => el.type === "text" && el.text.includes("\n"))) return elements;
  const out: LabelElement[] = [];
  for (const el of elements) {
    if (el.type !== "text" || !el.text.includes("\n")) {
      out.push(el);
      continue;
    }
    const step = textLineStepMm(el);
    const rot = el.rot ?? 0;
    // Satırların dizildiği (metne DİK) yön — rot'a göre: 0→aşağı, 90→sağ, 180→yukarı, 270→sol.
    const dir: [number, number] = rot === 90 ? [1, 0] : rot === 180 ? [0, -1] : rot === 270 ? [-1, 0] : [0, 1];
    el.text.split("\n").forEach((line, i) => {
      out.push({
        ...el,
        id: `${el.id}__l${i}`,
        text: line,
        x: Math.max(0, el.x + dir[0] * step * i),
        y: Math.max(0, el.y + dir[1] * step * i),
      });
    });
  }
  return out;
}

/** Varyant JSON'ından kanvas yerleşimini oku — geçersiz/boş → null (emit katmanı
 *  akış-modeline düşer; fail-safe). */
export function readCanvasLayout(raw: unknown): CanvasLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const layout = raw as { v?: unknown; elements?: unknown };
  if (layout.v !== CANVAS_SCHEMA_VERSION || !Array.isArray(layout.elements)) return null;
  if (layout.elements.length === 0) return null;
  const pad = parseCanvasPad((layout as { pad?: unknown }).pad);
  return { v: CANVAS_SCHEMA_VERSION, elements: layout.elements as LabelElement[], ...(pad ? { pad } : {}) };
}
