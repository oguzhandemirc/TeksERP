import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

const DAY_MS = 86_400_000;

/**
 * URL'den `dateFrom` / `dateTo` (ISO) okur. Yoksa son N gün uygular ve URL'e
 * yazar. Tüm rapor sayfalarında tek hook'tan filtre paylaşımı.
 */
export function useReportDateRange(defaultDays = 30) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get("dateFrom") || searchParams.get("dateTo")) return;
    const next = new URLSearchParams(searchParams);
    const today = new Date();
    const from = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - defaultDays,
      0, 0, 0, 0,
    );
    const to = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      23, 59, 59, 999,
    );
    next.set("dateFrom", from.toISOString());
    next.set("dateTo", to.toISOString());
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const params = useMemo(
    () => ({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }),
    [dateFrom, dateTo],
  );

  const setRange = (from: string, to: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("dateFrom", from);
    next.set("dateTo", to);
    setSearchParams(next, { replace: true });
  };

  const applyPreset = (days: number) => {
    const today = new Date();
    const from = new Date(
      today.getFullYear(), today.getMonth(), today.getDate() - days, 0, 0, 0, 0,
    );
    const to = new Date(
      today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999,
    );
    setRange(from.toISOString(), to.toISOString());
  };

  // Range'i milisaniye olarak ver, "günlük seri" üreten chart'larda işe yarar.
  const rangeDays = useMemo(() => {
    if (!dateFrom || !dateTo) return defaultDays;
    return Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / DAY_MS));
  }, [dateFrom, dateTo, defaultDays]);

  return { params, dateFrom, dateTo, rangeDays, setRange, applyPreset };
}
