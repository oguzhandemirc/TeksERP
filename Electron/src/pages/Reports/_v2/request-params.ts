// Rapor v2 isteği — URL durumu → `/api/reports/<anahtar>` sorgusu. SAF: bileşen testi doğrudan ölçer.
//
// Sözleşme: bu sayfanın URL'ini yalnız kendisi yazar. Tarih anahtarları katalogdaki `tarih`
// sözleşmesinden backend adına çevrilir (`_lib/report-date`); kalan her dolu anahtar bir parametre
// seçimidir (kıyas dahil — varsayılanı SUNUCU uygular ve beyan eder, K-KIYAS). "Tümü" = anahtar
// URL'de YOK ⇒ istekte de YOK (boş değer gönderilmez — strict şema 400 verir).
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import { REPORT_DATE_URL_KEYS, asOfParams, rangeDayParams, rangeIsoParams, toYmd, YMD_RE } from "../_lib/report-date";

/** Kıyas çipinin sunucu beyanındaki adı; beyan yoksa çip çizilmez (eski uç). */
export const COMPARE_PARAM = "kiyas";

function dateParams(entry: ReportCatalogEntry, search: URLSearchParams): Record<string, string | undefined> {
  switch (entry.tarih) {
    case "aralik-iso":
      return rangeIsoParams(search.get("dateFrom") ?? "", search.get("dateTo") ?? "");
    case "aralik-gun": {
      const from = search.get("dateFrom") ?? "";
      const to = search.get("dateTo") ?? "";
      return from && to ? rangeDayParams(from, to) : {};
    }
    case "kesit": {
      const raw = search.get("asOf") ?? "";
      return asOfParams(YMD_RE.test(raw) ? raw : toYmd(new Date()));
    }
    case "tek-gun": {
      const raw = search.get("factoryDay") ?? "";
      return { factoryDay: YMD_RE.test(raw) ? raw : toYmd(new Date()) };
    }
    case "ileri-pencere":
    case "yok":
      return {};
  }
}

/** Aralık sözleşmesinde tarih URL'e yazılmadan istek atılmaz (varsayılanı `ReportDateFilter` yazar; çift istek olmasın). */
export function requestReady(entry: ReportCatalogEntry, search: URLSearchParams): boolean {
  if (entry.tarih !== "aralik-iso" && entry.tarih !== "aralik-gun") return true;
  return Boolean(search.get("dateFrom") && search.get("dateTo"));
}

export function buildReportRequest(entry: ReportCatalogEntry, search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dateParams(entry, search))) if (v) out[k] = v;
  const reserved = new Set<string>(REPORT_DATE_URL_KEYS[entry.tarih]);
  for (const [k, v] of search.entries()) {
    if (reserved.has(k) || v === "") continue;
    out[k] = v;
  }
  return out;
}
