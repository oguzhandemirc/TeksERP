// =============================================================================
// Rapor HTTP istemcisi — domain bazlı namespace'lere ayrılır.
// Her domain `client.<domain>.<report>(params)` ile çağrılır; backend response
// `ReportResponse<T>` zarfında döner. Endpoint imzaları her etapta genişler.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ReportCompareParams, ReportResponse } from "./types";

/**
 * ⚠️ Backend şemaları `.strict()` — TANIMADIĞI parametre 400 döndürür (sessizce
 * yok saymaz). Bu yüzden burada yalnız BİLİNEN anahtarlar yazılır; `params`
 * nesnesini olduğu gibi querystring'e dökmek, çağıranın eklediği herhangi bir
 * alanla tüm raporu 400'e düşürürdü.
 */
async function getReport<T>(path: string, params: ReportCompareParams = {}): Promise<ReportResponse<T>> {
  const search = new URLSearchParams();
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
  if (params.compare) search.set("compare", params.compare);
  if (params.compareFrom) search.set("compareFrom", params.compareFrom);
  if (params.compareTo) search.set("compareTo", params.compareTo);
  const qs = search.toString();
  const res = await apiClient.get<ReportResponse<T>>(
    `/api/reports/${path}${qs ? `?${qs}` : ""}`,
  );
  return res.data;
}

/**
 * Domain methodlarını ekleyerek genişletilir. Etap N'deki implementasyon
 * altındaki dosyalar bu factory'yi `getReport` ile çağırır.
 */
export const reportsClient = {
  get: getReport,
};
