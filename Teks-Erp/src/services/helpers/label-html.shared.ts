// =============================================================================
// Roll/Swatch etiketi HTML — ortak yardımcılar (portrait + landscape paylaşır)
// =============================================================================
// Tipografi/format primitive'leri tek yerde: portrait (`label-html.helper`) ve
// landscape (`label-html-landscape.helper`) builder'ları buradan tüketir. Döngüsel
// import olmaması için ortak parça burada durur.
// =============================================================================

export interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: "sm" | "md" | "lg" | "xl";
}

/** Fiziksel etiket geometrisi — `LabelFormatProfile`'ın render girdisi.
 *  widthMm/heightMm = medya (fiziksel etiket); marginMm = GÜVENLİK PAYI (her
 *  kenardan içerik insetı, ölçüm/etiket toleransını emer). İçerik = width − 2×margin. */
export interface LabelFormatGeometry {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  /** Kenar-başına pay (mm); verilmezse marginMm kullanılır. Şimdilik PPLB üreticisi. */
  marginTopMm?: number;
  marginRightMm?: number;
  marginBottomMm?: number;
  marginLeftMm?: number;
  /** Etiketler arası boşluk (mm) — PPLB Q komutunun gap değeri. */
  gapMm?: number;
  orientation?: "PORTRAIT" | "LANDSCAPE";
}

/** Default geometri — DB boş / format verilmemişse. Argox OS 214 plus güvenli:
 *  100×148mm medya + 3mm pay → içerik 94×142mm (104mm kafa sınırının altında).
 *  (Seed artık 100×60 YATAY default verir; bu yalnız DB-boş kod fallback'idir.) */
export const DEFAULT_LABEL_FORMAT: Required<LabelFormatGeometry> = {
  widthMm: 100,
  heightMm: 148,
  marginMm: 3,
  marginTopMm: 3,
  marginRightMm: 3,
  marginBottomMm: 3,
  marginLeftMm: 3,
  gapMm: 2,
  orientation: "PORTRAIT",
};

// ---------------------------------------------------------------------------
// Template field görünürlük / etiket / stil yardımcıları
// ---------------------------------------------------------------------------

export function isVisible(fields: TemplateField[] | null, key: string): boolean {
  if (!fields) return true;
  const f = fields.find((x) => x.key === key);
  return f ? f.isVisible : false;
}

/**
 * isVisible'ın opt-out varyantı: alan template'te HİÇ yoksa AÇIK kabul eder.
 * Catalog'a sonradan eklenen alanlar (kartelaMark gibi) için — eski kayıtlı
 * template'lerde bulunmadıklarından generic isVisible onları gizlerdi.
 */
export function isVisibleDefaultOn(fields: TemplateField[] | null, key: string): boolean {
  if (!fields) return true;
  const f = fields.find((x) => x.key === key);
  return f ? f.isVisible : true;
}

export function fieldLabel(fields: TemplateField[] | null, key: string, fallback: string): string {
  if (!fields) return fallback;
  // L (düşük bulgu): label admin girdisidir ve HTML'e gömülür — değerler gibi
  // başlıklar da escape edilir (yazdırma penceresinde markup enjeksiyonu olmasın).
  return escapeHtml(fields.find((x) => x.key === key)?.label ?? fallback);
}

const FONT_SIZE_MAP: Record<string, string> = {
  sm: "8pt",
  md: "10pt",
  lg: "14pt",
  xl: "20pt",
};

export function fieldStyle(fields: TemplateField[] | null, key: string): string {
  if (!fields) return "";
  const f = fields.find((x) => x.key === key);
  if (!f) return "";
  const parts: string[] = [];
  if (f.isBold) parts.push("font-weight:700");
  if (f.fontSize) parts.push(`font-size:${FONT_SIZE_MAP[f.fontSize] ?? "10pt"}`);
  return parts.join(";");
}

export interface FieldHelpers {
  vis: (key: string) => boolean;
  lbl: (key: string, fallback: string) => string;
  sty: (key: string) => string;
}

/** Bir template field listesi için vis/lbl/sty closure'larını üretir. */
export function makeFieldHelpers(fields: TemplateField[] | null): FieldHelpers {
  return {
    vis: (key) => isVisible(fields, key),
    lbl: (key, fallback) => fieldLabel(fields, key, fallback),
    sty: (key) => fieldStyle(fields, key),
  };
}

// ---------------------------------------------------------------------------
// Değer formatlama + güvenlik
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatNumber(n: number | string | null | undefined): string {
  if (n == null) return "—";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "—";
  return (num as number).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yy} ${hh}:${mn}`;
}

/**
 * Saha #6: çoklu kopya — gövdedeki etiket bloğunu N sayfaya çoğalt (her kopya
 * kendi sayfasında; yazıcı arka arkaya basar). 1-5'e kırpılır.
 */
export function applyCopies(fullHtml: string, copies: number): string {
  const copiesCount = Math.max(1, Math.min(5, Math.floor(copies)));
  if (copiesCount <= 1) return fullHtml;
  const bodyOpen = fullHtml.indexOf("<body>") + "<body>".length;
  const bodyClose = fullHtml.indexOf("</body>");
  const labelMarkup = fullHtml.slice(bodyOpen, bodyClose);
  const pages = Array.from({ length: copiesCount }, (_, i) =>
    `<div style="${i < copiesCount - 1 ? "page-break-after: always;" : ""}">${labelMarkup}</div>`,
  ).join("\n");
  return fullHtml.slice(0, bodyOpen) + "\n" + pages + "\n" + fullHtml.slice(bodyClose);
}
