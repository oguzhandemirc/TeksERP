// Rapor formu dönem kısayolları ("Bu ay · Geçen ay · Son 30 gün") ve kesit seçimi (alt bölüm). Kısayol yalnız METİN kutularını doldurur (GG.AA.YYYY);
// gün fabrika diliminden (`factoryDayKey`), gövde kuralı `buildReportParams` (forms) ile aynen doğrulanır.
import { addDaysToKey, factoryDayEndIso, factoryDayKey, fmtDayKey } from "../../lib/factory-time";
import { trDateToIso } from "../../lib/forms";

export type ReportPeriod = "ozel" | "bu-ay" | "gecen-ay" | "son-30-gun";

export const REPORT_PERIODS: readonly { readonly key: ReportPeriod; readonly label: string }[] = [
  { key: "ozel", label: "Özel" },
  { key: "bu-ay", label: "Bu ay" },
  { key: "gecen-ay", label: "Geçen ay" },
  { key: "son-30-gun", label: "30 gün" },
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

// Kesit (`asOf`) seçimi: istemci yalnız GÜNÜ seçer; yaşlandırma hesabı fabrikada. Gün fabrika diliminden, gönderilen
// an o fabrika gününün son anıdır (fabrika şeması ISO an ister); "Bugün" boş gider → fabrika "şimdi"yi kullanır.
export type AsOfChoice = "bugun" | "dun" | "gecen-ay-sonu" | "ozel";

export const AS_OF_CHOICES: readonly { readonly key: AsOfChoice; readonly label: string }[] = [
  { key: "bugun", label: "Bugün" },
  { key: "dun", label: "Dün" },
  { key: "gecen-ay-sonu", label: "Ay sonu" }, // geçen ayın son günü; dar segmentte "Geçen ay sonu" kırpılıyordu, tam gün altta yazılı
  { key: "ozel", label: "Özel" },
];

/** Seçim → `asOf` değeri: undefined = gönderilmez (şimdi) · null = "Özel" metni GG.AA.YYYY değil · ISO an. */
export function asOfIso(choice: AsOfChoice, text: string, now: Date = new Date()): string | undefined | null {
  const today = factoryDayKey(now);
  if (choice === "bugun" || !today) return undefined;
  if (choice === "dun") return factoryDayEndIso(addDaysToKey(today, -1));
  if (choice === "gecen-ay-sonu") return factoryDayEndIso(addDaysToKey(`${today.slice(0, 8)}01`, -1));
  const day = trDateToIso(text);
  return typeof day === "string" ? factoryDayEndIso(day) : day;
}

/** Seçimin kullanıcıya okunan günü (GG.AA.YYYY); "Özel"de metnin kendisi. */
export function asOfDayText(choice: AsOfChoice, now: Date = new Date()): string | null {
  const today = factoryDayKey(now);
  if (!today || choice === "ozel") return null;
  if (choice === "bugun") return fmtDayKey(today);
  if (choice === "dun") return fmtDayKey(addDaysToKey(today, -1));
  return fmtDayKey(addDaysToKey(`${today.slice(0, 8)}01`, -1));
}
