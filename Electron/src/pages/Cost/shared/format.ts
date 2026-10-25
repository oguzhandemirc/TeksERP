// MAL-3 — maliyet sayılarının SUNUM katmanı. Sayı sunucudan Decimal metni olarak gelir ("77.0395");
// burada yalnız TR biçimine çevrilir: string girdi Intl'e TAM ondalık olarak verilir (float'a çevrilmez),
// toplama/çarpma YOK — hesap tek yerde, `POST /api/cost/preview` (kural: istemci hesap yapmaz).

type DecText = string | number | null | undefined;

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

/** Sunucu sayısını TR biçimine çevirir; `digits` yalnız GÖSTERİM hanesidir (yarım-yukarı, Intl). */
export function fmtDec(v: DecText, digits = 2, fallback = "—"): string {
  if (v === null || v === undefined || v === "") return fallback;
  // Intl.NumberFormat v3: metin girdi tam ondalık biçimlenir ("77.0395" → "77,04"); float sapması yok.
  return (nf(digits, digits).format as (x: string | number) => string)(v);
}

/** Hane kesmeden biçim (birim fiyat, kur): sunucunun hanesi kadar, en çok `max`. */
export function fmtDecFull(v: DecText, max = 4, fallback = "—"): string {
  if (v === null || v === undefined || v === "") return fallback;
  return (nf(0, max).format as (x: string | number) => string)(v);
}

export const fmtPct = (v: DecText, fallback = "—"): string => (v === null || v === undefined || v === "" ? fallback : `%${fmtDecFull(v, 2)}`);

/** Formdan gelen TR yazımını sunucunun Decimal metnine çevirir ("1.234,5" → "1234.5"); sayıya ÇEVİRMEZ. */
export function toDecimalText(raw: string): string | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!t) return null;
  return t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
}

/** Sunucu Decimal metnini form alanına TR yazımıyla koyar ("18.0000" → "18"). */
export function decToInput(v: DecText): string {
  if (v === null || v === undefined || v === "") return "";
  return String(v).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",");
}

const DAY_MS = 86_400_000;
/** Fiyatın yaşı (gün) — plan §2.2 `PRICE_STALE` eşiği 90 gün; rozet içindir, hesap girdisi değildir. */
export function ageDays(iso: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS);
}
export const STALE_DAYS = 90;
