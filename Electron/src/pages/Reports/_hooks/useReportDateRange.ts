import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { REPORT_BY_KEY, type ReportKey } from "@/lib/report-catalog";
import { backWindowIso, rangeIsoParams } from "../_lib/report-date";

const DAY_MS = 86_400_000;

/**
 * Varsayılan gün sayısı KATALOGDAN (K7): yaprak sayı yazmaz. Katalogda `null` olan bir
 * satır (günsüz sözleşme ya da `finance/statement` diyaloğu) bu hook'u çağıramaz —
 * sessiz 30 uydurmak yerine geliştirme hatası.
 */
export function catalogDefaultDays(reportKey: ReportKey): number {
  const entry = REPORT_BY_KEY.get(reportKey);
  if (!entry) throw new Error(`Rapor kataloğunda yok: ${reportKey}`);
  if (entry.tarih !== "aralik-iso" && entry.tarih !== "aralik-gun") {
    throw new Error(`${reportKey}: tarih sözleşmesi '${entry.tarih}', aralık hook'u kullanılamaz`);
  }
  if (entry.varsayilanGun === null) throw new Error(`${reportKey}: katalogda varsayılan gün yok (URL aralığı çizilemez)`);
  return entry.varsayilanGun;
}

/**
 * URL'den `dateFrom` / `dateTo` (ISO) okur. Yoksa katalogdaki "son N gün"ü uygular ve
 * URL'e yazar. Tüm aralık raporlarında tek hook'tan filtre paylaşımı; parametre adı
 * `_lib/report-date` sözleşmesinden.
 */
export function useReportDateRange(reportKey: ReportKey) {
  const defaultDays = catalogDefaultDays(reportKey);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("dateFrom") || searchParams.get("dateTo")) return;
    const next = new URLSearchParams(searchParams);
    const w = backWindowIso(defaultDays);
    next.set("dateFrom", w.dateFrom);
    next.set("dateTo", w.dateTo);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const params = useMemo(() => rangeIsoParams(dateFrom, dateTo), [dateFrom, dateTo]);

  const setRange = (from: string, to: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("dateFrom", from);
    next.set("dateTo", to);
    setSearchParams(next, { replace: true });
  };

  const applyPreset = (days: number) => {
    const w = backWindowIso(days);
    setRange(w.dateFrom, w.dateTo);
  };

  // Range'i gün olarak ver, "günlük seri" üreten chart'larda işe yarar.
  const rangeDays = useMemo(() => {
    if (!dateFrom || !dateTo) return defaultDays;
    return Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / DAY_MS));
  }, [dateFrom, dateTo, defaultDays]);

  return { params, dateFrom, dateTo, rangeDays, setRange, applyPreset, defaultDays };
}
