// =============================================================================
// Etiket Stüdyosu — kanvas eleman modeli (backend config/label-elements.ts eşi)
// =============================================================================
// Backend tek doğru kaynaktır (validateCanvasLayout + CAPABILITY); buradaki
// tipler ve degrade matrisi onunla BİREBİR tutulur. Koordinatlar mm, tuval
// sol-üst orijin. Eleman-düzeyi doğrulama backend'te; editör lint'i (çakışma/
// taşma/degrade) kullanıcıya erken uyarı içindir.

export const CANVAS_SCHEMA_VERSION = 1;

export type CanvasFontSize = "sm" | "md" | "lg" | "xl";
export type CanvasRotation = 0 | 90 | 180 | 270;

export type LabelElementType =
  | "field"
  | "text"
  | "qr"
  | "code128"
  | "line"
  | "box"
  | "lengthBanner";

interface ElementBase {
  id: string;
  x: number;
  y: number;
}

export interface FieldElement extends ElementBase {
  type: "field";
  bind: string;
  label?: string;
  font?: CanvasFontSize;
  bold?: boolean;
  rot?: CanvasRotation;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  font?: CanvasFontSize;
  bold?: boolean;
  rot?: CanvasRotation;
}

export interface QrElement extends ElementBase {
  type: "qr";
  scale?: number; // 2-15, yok → 5
}

export interface Code128Element extends ElementBase {
  type: "code128";
  hMm?: number; // yok → 9
  human?: boolean; // yok → true
  /** Modül (dar çubuk) kalınlığı dot (1-4). Yok → 2. Genişlik serbest ölçü değil —
   *  okunabilirlik için tam-sayı dot şart; büyütme bu kademeyle ORANTILI. */
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
  thickMm?: number;
}

export interface LengthBannerElement extends ElementBase {
  type: "lengthBanner";
  wMm?: number;
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

/** Dil yetenek (degrade) matrisi — backend CAPABILITY ile birebir. "skip" =
 *  eleman o dilde SESSİZCE basılmaz; editör rozet gösterir. */
export const CAPABILITY: Record<LabelElementType, Record<"PPLA" | "PPLB" | "ZPL" | "RASTER_HTML", "ok" | "skip">> = {
  field:        { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  text:         { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  qr:           { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  code128:      { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  // line/box: DPL font-X kayıtlarıyla PPLA'da da basılır.
  line:         { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  box:          { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
  // lengthBanner PPLA'da basılamaz: ters-renk (siyah zemin/beyaz değer) ister,
  // DPL'de güvenilir reverse yok (PPLB 'R' / ZPL ^FR var).
  lengthBanner: { PPLA: "skip", PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
};

/** Elemanın basılMAdığı diller (rozet metni için). */
export function skippedLanguages(type: LabelElementType): string[] {
  const row = CAPABILITY[type];
  if (!row) return [];
  return (Object.keys(row) as Array<keyof typeof row>).filter((l) => row[l] === "skip");
}

export const elementTypeLabels: Record<LabelElementType, string> = {
  field: "Veri Alanı",
  text: "Sabit Metin",
  qr: "QR Kod",
  code128: "Barkod (Code128)",
  line: "Çizgi / Dolu Kutu",
  box: "Çerçeve",
  lengthBanner: "Metraj Bandı",
};
