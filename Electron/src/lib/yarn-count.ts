// İplik numarası çevirici (Seyitoğlu SY-a): dtex / Nm / Ne / g/m → denye. Yalnız iplik kartı formunun
// YARDIMCISI — sonuç kullanıcı "Uygula" deyince denye alanına yazılır; maliyet sunucuda denyeyle hesaplanır.
// Fiziksel sabitler: denye = 9000 m'nin gramı; dtex = 10000 m'nin gramı; Nm = gram başına metre;
// Ne (pamuk) = libre (453,59237 g) başına 840 yarda (768,096 m) çile → denye = 5314,88 / Ne.

export type YarnCountUnit = "DTEX" | "NM" | "NE" | "G_PER_M";

export const YARN_COUNT_UNIT_LABEL: Record<YarnCountUnit, string> = {
  DTEX: "dtex",
  NM: "Nm",
  NE: "Ne",
  G_PER_M: "g/m",
};

const NE_FACTOR = 5314.88;

/** Sayı → denye; geçersiz/sıfır/negatif girdi `null`. */
export function toDenier(value: number, unit: YarnCountUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  switch (unit) {
    case "DTEX":
      return value * 0.9;
    case "NM":
      return 9000 / value;
    case "NE":
      return NE_FACTOR / value;
    case "G_PER_M":
      return value * 9000;
  }
}

/** Denye alanının biçimi: nokta ondalık, en çok 4 hane, sondaki sıfırlar atılır (Decimal(10,4)). */
export function formatDenierText(den: number): string {
  return String(Number(den.toFixed(4)));
}

/** Kullanıcı metni ("1,5" ya da "1.5") → sayı; boş/geçersiz `NaN`. */
export function parseLooseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  return t === "" ? NaN : Number(t);
}

/**
 * "600 KAR İPİ" tipi addan denye ÖNERİSİ (kullanıcı kararı 2026-11-21): ad sayıyı taşıyorsa öneri olarak
 * gösterilir, kullanıcı onaylar ya da düzeltir; sessiz atama YOK. "… 70 DN" gibi açık denye eki önce gelir,
 * yoksa addaki ilk sayı. Sayı yoksa `null`.
 */
export function denierSuggestionFromName(name: string): string | null {
  const explicit = /(\d+(?:[.,]\d+)?)\s*(?:DN|DEN|DENYE|D)(?![\p{L}])/iu.exec(name);
  const any = explicit ?? /(\d+(?:[.,]\d+)?)/.exec(name);
  if (!any) return null;
  const n = parseLooseNumber(any[1]!);
  return Number.isFinite(n) && n > 0 ? formatDenierText(n) : null;
}
