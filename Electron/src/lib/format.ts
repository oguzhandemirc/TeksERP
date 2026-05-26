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

export function formatNumber(
  n: number | string | null | undefined,
  fractionDigits = 2,
): string {
  if (n == null) return "—";
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: fractionDigits,
  }).format(num);
}
