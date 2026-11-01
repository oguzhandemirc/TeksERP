import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ReportCatalogEntry } from "@/lib/report-catalog";
import { errorCodeOf } from "@/pages/Operations/LoomAlarms/alarm-access";
import type { RaporSunumu } from "./sunum";
import { buildReportRequest, requestReady } from "./request-params";

interface PresentationResponse {
  success: true;
  data: RaporSunumu;
}

/** Hata sınıfı — ekran her birine AYRI Türkçe mesaj basar (modül kapalı ≠ rapor kapalı ≠ yetki). */
export type ReportFailure = "module-disabled" | "report-disabled" | "forbidden" | "other";

export function failureOf(error: unknown): ReportFailure {
  const code = errorCodeOf(error);
  if (code === "MODULE_DISABLED") return "module-disabled";
  if (code === "REPORT_DISABLED") return "report-disabled";
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 ? "forbidden" : "other";
}

export async function fetchPresentation(key: string, params: Record<string, string>): Promise<RaporSunumu> {
  const qs = new URLSearchParams(params).toString();
  // Kapı hatası ekranda kalıcı mesajla anlatılır; genel toast'ı bastır (tekrar eden toast yağmuru olmasın).
  const res = await apiClient.get<PresentationResponse>(`/api/reports/${key}${qs ? `?${qs}` : ""}`, { suppressErrorToast: true });
  return res.data.data;
}

/** v2 raporunun TEK veri kancası: URL → istek → `RaporSunumu`. `allowed=false` koşulsuz 403 verecek isteği atmaz (SY-D3). */
export function useReportV2(entry: ReportCatalogEntry, allowed = true) {
  const [search] = useSearchParams();
  const searchText = search.toString();
  const params = useMemo(() => buildReportRequest(entry, new URLSearchParams(searchText)), [entry, searchText]);
  const ready = requestReady(entry, new URLSearchParams(searchText));
  const query = useQuery({
    queryKey: ["report-v2", entry.key, params],
    queryFn: () => fetchPresentation(entry.key, params),
    enabled: ready && allowed,
    retry: (count, error) => failureOf(error) === "other" && count < 1,
  });
  return { ...query, params, ready };
}
