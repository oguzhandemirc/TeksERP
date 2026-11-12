import { formatCalendarDay, formatFactory } from "@/lib/factory-time";

/** Tarih/saat kalıpla, FABRİKA diliminde (date-fns belirteçleri; bkz. `lib/factory-time`). */
export function safeFormat(
  date: string | Date | null | undefined,
  fmt: string,
  fallback = "—",
): string {
  if (!date) return fallback;
  return formatFactory(date, fmt, fallback);
}

/** TAKVİM GÜNÜ alanı (termin · vade · planlanan tarih) kalıpla — `formatCalendarDay` kuralı (UTC gece yarısı gün kaymaz). */
export function safeFormatCalendar(
  date: string | Date | null | undefined,
  fmt: string,
  fallback = "—",
): string {
  if (!date) return fallback;
  return formatCalendarDay(date, fmt, fallback);
}

// =============================================================================
// SAYI BİÇİMİ KURALI (kullanıcı 2026-11-12) — panelin TEK sayı biçimleyicisi burasıdır:
//   · PARA binlik ayırıcılı, 2 hane: "325.684,90 TRY" (`formatMoney` · `formatAmount` · `amountFormatter`).
//   · ÖLÇÜ / SAYIM / YÜZDE ayırıcısız: "14700 m", "10500 kg", "%12,5" (diğer her biçimleyici).
// Ondalık virgül, sabit "tr-TR" (süreç yerel ayarından bağımsız). Panelde çıplak `toLocaleString`/`Intl.NumberFormat`
// yasak (`test_yerel_ayar_bagimliligi` §5); rapor hücresi/eksen biçimi `lib/number-format.ts`te aynı kuralı izler.
// =============================================================================
// Perf: Intl.NumberFormat kurulumu görece pahalı; (min, max, gruplama) başına tek formatter (render başına onlarca çağrı).
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(min: number, max: number, grouping: boolean): Intl.NumberFormat {
  const key = `${min}:${max}:${grouping ? 1 : 0}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max), useGrouping: grouping });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Ham sınıflı biçim — "-0" düzeltmesi YOK (Excel sıfıra yuvarlanan negatifi "-0,0" gösterir; PDF = Excel eşitliği
 * için `lib/number-format` bunu kullanır). `grouped` = para sınıfı.
 */
export function formatClassed(n: number, minFractionDigits: number, maxFractionDigits: number, grouped: boolean): string {
  return formatter(minFractionDigits, maxFractionDigits, grouped).format(n);
}

/** Ölçü/sayım sayısı (ayırıcısız), en çok `fractionDigits` hane: 14700 → "14700", 230,55 → "230,55". */
export function formatNumber(
  n: number | string | null | undefined,
  fractionDigits = 2,
): string {
  if (n == null) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "—";
  return formatter(0, fractionDigits, false).format(num);
}

/**
 * SABİT haneli ölçü sayısı (239,5 → "239,50") — irsaliye/belge metre sütunu (`ondalik: 2`) ile aynı hane sayısı,
 * böylece liste ile basılı belge aynı rakamı gösterir. Ayırıcısız (ölçü sınıfı); para için `formatAmount`.
 */
export function formatFixed(n: number | string | null | undefined, fractionDigits = 2): string {
  if (n == null) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "—";
  return formatter(fractionDigits, fractionDigits, false).format(num);
}

function toFinite(n: number | string | null | undefined): number | null {
  if (n == null || n === "") return null;
  const num = typeof n === "number" ? n : Number(n);
  return Number.isFinite(num) ? num : null;
}

/** Yuvarlamada "-0" / "-0,00" basılmasın. */
const noNegZero = (s: string): string => (/^-0(,0+)?$/.test(s) ? s.slice(1) : s);

/**
 * Ölçü/sayım sayısı, serbest hane aralığı (ayırıcısız): `formatQty(1250.5)` → "1250,5", `formatQty(2, 3, 2)` → "2,00".
 * Çıplak `toLocaleString` yerine geçer (onun varsayılanı en çok 3 hane).
 */
export function formatQty(n: number | string | null | undefined, maxFractionDigits = 3, minFractionDigits = 0, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : noNegZero(formatter(minFractionDigits, maxFractionDigits, false).format(num));
}

/** Para sayısı, birimsiz (binlik ayırıcılı): `formatAmount(325684.9)` → "325.684,90"; kur/birim fiyat `formatAmount(v, 2, 4)`. */
export function formatAmount(n: number | string | null | undefined, minFractionDigits = 2, maxFractionDigits = minFractionDigits, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : noNegZero(formatter(minFractionDigits, maxFractionDigits, true).format(num));
}

/** Sabit `Intl.NumberFormat` örneği yerine — ölçü sınıfı (ayırıcısız). */
export function qtyFormatter(maxFractionDigits: number, minFractionDigits = 0): { format: (n: number) => string } {
  return { format: (n: number) => formatQty(n, maxFractionDigits, minFractionDigits, String(n)) };
}

/** Sabit `Intl.NumberFormat` örneği yerine — para sınıfı (binlik ayırıcılı). */
export function amountFormatter(minFractionDigits = 2, maxFractionDigits = minFractionDigits): { format: (n: number) => string } {
  return { format: (n: number) => formatAmount(n, minFractionDigits, maxFractionDigits, String(n)) };
}

// =============================================================================
// GÖSTERİM SAYISI — özet yüzeylerinin (pano kutuları, KPI kartı, insight/record bileşenleri, Rapor Merkezi,
// liste özet bantları) TEK biçimi. Ölçü/sayım/yüzde ayırıcısız ("62.990 m" ondalık gibi okunuyor);
// PARA HARİÇ — para binlik ayırıcılıdır (`formatMoney`, kullanıcı kuralı 2026-11-12).
// =============================================================================

/** Gösterim sayısı: 4295 → "4295", 10500,25 → "10500,3" (en çok `maxFractionDigits` hane, tam sayıda hanesiz). */
export function formatDisplay(n: number | string | null | undefined, maxFractionDigits = 1, fallback = "—"): string {
  return formatQty(n, maxFractionDigits, 0, fallback);
}

/** Ölçü: metre/kg en çok 1 hane — `formatMeasure(4295, "m")` → "4295 m". */
export function formatMeasure(n: number | string | null | undefined, unit: string, maxFractionDigits = 1, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : `${formatDisplay(num, maxFractionDigits)} ${unit}`;
}

/** Para: HEP 2 hane, binlik ayırıcılı — `formatMoney(325684.9, "TRY")` → "325.684,90 TRY"; birimsiz çağrıda yalnız sayı. */
export function formatMoney(n: number | string | null | undefined, currency?: string | null, fallback = "—"): string {
  const num = toFinite(n);
  if (num === null) return fallback;
  const text = formatAmount(num);
  return currency ? `${text} ${currency}` : text;
}

/** Yüzde: "%12,5" (Türkçe ön ek), en çok 1 hane. */
export function formatPercent(n: number | string | null | undefined, maxFractionDigits = 1, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : `%${formatDisplay(num, maxFractionDigits)}`;
}
