// =============================================================================
// Rapor HTTP istemcisi — domain bazlı namespace'lere ayrılır.
// Her domain `client.<domain>.<report>(params)` ile çağrılır; backend response
// `ReportResponse<T>` zarfında döner. Endpoint imzaları her etapta genişler.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ReportCompareParams, ReportResponse } from "./types";

/** Sayfanın kurduğu istek: tarih/karşılaştırma + eksen anahtarları (CSV) — anahtar kümesi sayfada, sözleşme `reportAxisCoverage`. */
export type ReportQueryParams = ReportCompareParams | Record<string, string | undefined>;

/**
 * SÖZLEŞME: sayfanın `params`ı = isteğin querystring'i. Boş/undefined değer yazılmaz.
 *
 * ⚠️ Eskiden burada yalnız tarih/karşılaştırma anahtarları yazılıyordu ("strict şema
 * 400 vermesin" diye); sayfaların eklediği eksenler (`customerId` · `destination` …)
 * SESSİZCE DÜŞÜYOR, ekran "SÜZGEÇ — Müşteri: X" yazarken sayılar herkesin toplamı
 * çıkıyordu (d9 sürücüsü L4, 2026-09-18). Allowlist istemci katmanında yaşamaz: hangi
 * eksenin hangi uca gideceğini sayfa `AXIS_KEYS` ile beyan eder ve `reportAxisCoverage`
 * bunu sunucu sözleşmesiyle eşler; bilinmeyen anahtar yine 400'dür — ve GÖRÜNÜR olur.
 * Bekçi: `reportsClient.test.ts` (18 uç) + `reportAxisRequest.test.tsx` (sayfa → istek).
 */
async function getReport<T>(path: string, params: ReportQueryParams = {}): Promise<ReportResponse<T>> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) search.set(key, value);
  }
  const qs = search.toString();
  const res = await apiClient.get<ReportResponse<T>>(`/api/reports/${path}${qs ? `?${qs}` : ""}`);
  return res.data;
}

/**
 * Domain methodlarını ekleyerek genişletilir. Etap N'deki implementasyon
 * altındaki dosyalar bu factory'yi `getReport` ile çağırır.
 */
export const reportsClient = {
  get: getReport,
};
