import { format, isValid } from "date-fns";

export function safeFormat(
  date: string | Date | null | undefined,
  fmt: string,
  fallback = "—",
): string {
  if (!date) return fallback;
  const d = typeof date === "string" ? new Date(date) : date;
  if (!isValid(d)) return fallback;
  return format(d, fmt);
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
