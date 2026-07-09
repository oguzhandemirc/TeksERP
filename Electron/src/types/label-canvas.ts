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
  /** ESKİ 4-kademe (geri uyum) — hMm doluysa yok sayılır. */
  font?: CanvasFontSize;
  /** SERBEST yükseklik (mm, 1-30): ZPL/HTML birebir; PPLA/PPLB en yakın
   *  basılabilir kombinasyona oturur (5 font × çarpanlar — eski 4 kademeden
   *  çok daha granüler). */
  hMm?: number;
  /** Genişlik oranı (0.25-4, 1=doğal) — dar/geniş; bitmap'te "ince/kalın" görünüm. */
  wr?: number;
  /** hMm YOKKEN eski anlam (2x çarpan); hMm doluysa yalnız HTML kalınlığı. */
  bold?: boolean;
  rot?: CanvasRotation;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  font?: CanvasFontSize;
  hMm?: number;
  wr?: number;
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
  /** Okunur satır (barkod altı kod) yüksekliği (mm, 1-20) — büyüt/küçült. Yok →
   *  küçük varsayılan (dile-özel sabit). */
  humanHMm?: number;
  /** Okunur satırı ortalanmış konumdan kaydırma (mm, ±). Yok → 0 = tam ortalı. */
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
  thickMm?: number;
}

export interface LengthBannerElement extends ElementBase {
  type: "lengthBanner";
  wMm?: number;
  hMm?: number;
  /** Değerin dönüşü (0/90/180/270). Yok → 90 (dikey bant). */
  rot?: CanvasRotation;
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
  // lengthBanner: PPLB/ZPL/HTML siyah zemin+beyaz değer; PPLA çerçeveli (DPL
  // reverse güvenilmez) — hepsi basılır ("ok"), yalnız görünüm dolgusu farklı.
  lengthBanner: { PPLA: "ok",   PPLB: "ok", ZPL: "ok", RASTER_HTML: "ok" },
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
