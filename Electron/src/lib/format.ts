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

// Perf: Intl.NumberFormat kurulumu görece pahalı; locale + useGrouping sabit,
// yalnız fractionDigits değişiyor. fractionDigits başına tek formatter cache'le
// (formatNumber render başına onlarca kez çağrılıyor — WorkOrderDetailSheet, kart
// ve tablo hücreleri). Çıktı birebir aynı.
const numberFormatterCache = new Map<number, Intl.NumberFormat>();

function getNumberFormatter(fractionDigits: number): Intl.NumberFormat {
  let fmt = numberFormatterCache.get(fractionDigits);
  if (!fmt) {
    // useGrouping:false → binlik ayıracı YOK (1000 → "1000", "1.000" DEĞİL; TR'de yanlış
    // anlaşılıyor). Ondalık virgül korunur (230,5). Kullanıcı kuralı — tüm program.
    fmt = new Intl.NumberFormat("tr-TR", {
      maximumFractionDigits: fractionDigits,
      useGrouping: false,
    });
    numberFormatterCache.set(fractionDigits, fmt);
  }
  return fmt;
}

export function formatNumber(
  n: number | string | null | undefined,
  fractionDigits = 2,
): string {
  if (n == null) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "—";
  return getNumberFormatter(fractionDigits).format(num);
}

/**
 * SABİT haneli sayı (239,5 → "239,50") — irsaliye/belge metre sütunu (`ondalik: 2`) ile aynı hane sayısı,
 * böylece liste ile basılı belge aynı rakamı gösterir. Binlik ayıracı yok (program kuralı, `formatNumber` emsali).
 */
export function formatFixed(n: number | string | null | undefined, fractionDigits = 2): string {
  if (n == null) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("tr-TR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits, useGrouping: false });
}

// =============================================================================
// GÖSTERİM SAYISI — özet yüzeylerinin (pano kutuları, KPI kartı, insight/record bileşenleri, Rapor Merkezi,
// liste özet bantları) TEK biçimi: binlik nokta, ondalık virgül, sabit "tr-TR" (süreç yerel ayarından bağımsız).
// Tablo/form/etiket hücreleri `formatNumber` (gruplamasız) ile kalır; bu ayrım bilinçli (2026-11-12 cila turu).
// =============================================================================
const groupedCache = new Map<string, Intl.NumberFormat>();

function grouped(min: number, max: number): Intl.NumberFormat {
  const key = `${min}:${max}`;
  let f = groupedCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: true });
    groupedCache.set(key, f);
  }
  return f;
}

function toFinite(n: number | string | null | undefined): number | null {
  if (n == null || n === "") return null;
  const num = typeof n === "number" ? n : Number(n);
  return Number.isFinite(num) ? num : null;
}

/** Gösterim sayısı: 4295 → "4.295", 10500,25 → "10.500,3" (en çok `maxFractionDigits` hane, tam sayıda hanesiz). */
export function formatDisplay(n: number | string | null | undefined, maxFractionDigits = 1, fallback = "—"): string {
  const num = toFinite(n);
  if (num === null) return fallback;
  // Yuvarlamada "-0" basılmasın.
  const out = grouped(0, maxFractionDigits).format(num);
  return out === "-0" ? "0" : out;
}

/** Ölçü: metre/kg en çok 1 hane — `formatMeasure(4295, "m")` → "4.295 m". */
export function formatMeasure(n: number | string | null | undefined, unit: string, maxFractionDigits = 1, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : `${formatDisplay(num, maxFractionDigits)} ${unit}`;
}

/** Para: HEP 2 hane — `formatMoney(325684.9, "TRY")` → "325.684,90 TRY"; birimsiz çağrıda yalnız sayı. */
export function formatMoney(n: number | string | null | undefined, currency?: string | null, fallback = "—"): string {
  const num = toFinite(n);
  if (num === null) return fallback;
  const text = grouped(2, 2).format(num);
  return currency ? `${text} ${currency}` : text;
}

/** Yüzde: "%12,5" (Türkçe ön ek), en çok 1 hane. */
export function formatPercent(n: number | string | null | undefined, maxFractionDigits = 1, fallback = "—"): string {
  const num = toFinite(n);
  return num === null ? fallback : `%${formatDisplay(num, maxFractionDigits)}`;
}
