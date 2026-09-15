import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { REPORT_BY_KEY, type ReportKey, type ReportTarih } from "@/lib/report-catalog";
import { asOfParams, toYmd, YMD_RE } from "../_lib/report-date";

/**
 * TEK GÜN sözleşmeleri — `tek-gun` (URL `factoryDay`, fabrika günü) ve `kesit` (URL `asOf`,
 * günün SONU itibarıyla). URL'de yoksa BUGÜN; bugün URL'e YAZILMAZ (paylaşılan link
 * "bugün"ü değil seçilen günü taşımalı — Aging kalıbı). Yenilemede kaybolmasın diye
 * durum URL'dedir, `useState` değil.
 */
export function useReportDayState(reportKey: ReportKey, expected?: ReportTarih) {
  const entry = REPORT_BY_KEY.get(reportKey);
  if (!entry) throw new Error(`Rapor kataloğunda yok: ${reportKey}`);
  if (entry.tarih !== "tek-gun" && entry.tarih !== "kesit") {
    throw new Error(`${reportKey}: tarih sözleşmesi '${entry.tarih}', tek-gün hook'u kullanılamaz`);
  }
  if (expected && entry.tarih !== expected) throw new Error(`${reportKey}: '${entry.tarih}' sözleşmesi, '${expected}' bekleniyordu`);
  const contract = entry.tarih;
  const urlKey = contract === "kesit" ? "asOf" : "factoryDay";
  const [searchParams, setSearchParams] = useSearchParams();
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const raw = searchParams.get(urlKey) ?? "";
  const ymd = YMD_RE.test(raw) ? raw : todayYmd;

  const setYmd = (next: string) => {
    const sp = new URLSearchParams(searchParams);
    if (!next || next === todayYmd) sp.delete(urlKey);
    else sp.set(urlKey, next);
    setSearchParams(sp, { replace: true });
  };

  return { contract, ymd, todayYmd, setYmd, isToday: ymd === todayYmd };
}

/** `tek-gun`: backend `factoryDay` (fabrika günü `YYYY-MM-DD`). */
export function useFactoryDay(reportKey: ReportKey) {
  const state = useReportDayState(reportKey, "tek-gun");
  const params = useMemo(() => ({ factoryDay: state.ymd }), [state.ymd]);
  return { ...state, params };
}

/** `kesit`: backend `asOf` — seçilen günün SONU (ISO). */
export function useAsOfDay(reportKey: ReportKey) {
  const state = useReportDayState(reportKey, "kesit");
  const params = useMemo(() => asOfParams(state.ymd), [state.ymd]);
  return { ...state, params };
}
