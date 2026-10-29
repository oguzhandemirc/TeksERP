// Metre sapmaları servisi — yollar TAM (`/api/...`; apiClient baseURL `/api` içermez). Süzme SUNUCUDA (`filter[...]`).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DeviationFilter, MeterDeviationPage } from "./types";

export const METER_DEVIATIONS_QUERY_KEY = "kursun-meter-deviations";
const BASE = "/api/kursun-qc";

/** Süzgeç → sorgu parametreleri (saf; boş alan gönderilmez). */
export function deviationParams(f: DeviationFilter, cursor: string | null, limit = 50): Record<string, string> {
  const p: Record<string, string> = { limit: String(limit) };
  if (f.status) p["filter[status]"] = f.status;
  if (f.machineId) p["filter[machineId]"] = f.machineId;
  if (f.customerId) p["filter[customerId]"] = f.customerId;
  if (f.from) p["filter[fromDay]"] = f.from;
  if (f.to) p["filter[toDay]"] = f.to;
  if (cursor) p.cursor = cursor;
  return p;
}

export async function listMeterDeviations(f: DeviationFilter, cursor: string | null): Promise<MeterDeviationPage> {
  return (await apiClient.get<MeterDeviationPage>(`${BASE}/meter-deviations`, { params: deviationParams(f, cursor) })).data;
}

/** Ofis onayı — ikinci onay 409 `METER_ALREADY_ACKED` (genel toast Türkçe mesajı basar). */
export async function officeAckMeterReading(readingId: string, reasonText: string | null): Promise<unknown> {
  const body = reasonText ? { reasonText } : {};
  return (await apiClient.post<ApiResponse<unknown>>(`${BASE}/meter-readings/${readingId}/office-ack`, body)).data.data;
}
