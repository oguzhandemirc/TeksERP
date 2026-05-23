// =============================================================================
// Rapor HTTP istemcisi — domain bazlı namespace'lere ayrılır.
// Her domain `client.<domain>.<report>(params)` ile çağrılır; backend response
// `ReportResponse<T>` zarfında döner. Endpoint imzaları her etapta genişler.
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ReportDateParams, ReportResponse } from "./types";

async function getReport<T>(path: string, params: ReportDateParams = {}): Promise<ReportResponse<T>> {
  const search = new URLSearchParams();
  if (params.dateFrom) search.set("dateFrom", params.dateFrom);
  if (params.dateTo) search.set("dateTo", params.dateTo);
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
