// Rapor formu dönem kısayolları: "Bu ay · Geçen ay · Son 30 gün" yalnız METİN kutularını doldurur (GG.AA.YYYY);
// gün fabrika diliminden (`factoryDayKey`), gövde kuralı `buildReportParams` (forms) ile aynen doğrulanır.
import { addDaysToKey, factoryDayKey, fmtDayKey } from "../../lib/factory-time";

export type ReportPeriod = "ozel" | "bu-ay" | "gecen-ay" | "son-30-gun";

export const REPORT_PERIODS: readonly { readonly key: ReportPeriod; readonly label: string }[] = [
  { key: "ozel", label: "Özel" },
  { key: "bu-ay", label: "Bu ay" },
  { key: "gecen-ay", label: "Geçen ay" },
  { key: "son-30-gun", label: "Son 30 gün" },
];

/** Kısayolun başlangıç/bitiş metni (GG.AA.YYYY); "Özel" metni değiştirmez → null. */
export function periodText(p: ReportPeriod, now: Date = new Date()): { from: string; to: string } | null {
  const today = factoryDayKey(now);
  if (!today || p === "ozel") return null;
  const monthStart = `${today.slice(0, 8)}01`;
  if (p === "bu-ay") return { from: fmtDayKey(monthStart), to: fmtDayKey(today) };
  if (p === "gecen-ay") {
    const prevEnd = addDaysToKey(monthStart, -1);
    return { from: fmtDayKey(`${prevEnd.slice(0, 8)}01`), to: fmtDayKey(prevEnd) };
  }
  return { from: fmtDayKey(addDaysToKey(today, -29)), to: fmtDayKey(today) };
}
