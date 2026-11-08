// Fason kokpiti servisi — yol TAM (`/api/...`). Liste + özet şeridi TEK uçtan, süzme SUNUCUDA (`filter[...]`).
import apiClient from "@/services/apiClient";
import type { CockpitFilter, SubcontractorCockpitResult } from "./types";

export const FASON_COCKPIT_QUERY_KEY = "fason-cockpit";

/** Süzgeç → sorgu (saf; varsayılan/boş alan gönderilmez). */
export function cockpitParams(f: CockpitFilter, cursor: string | null, limit = 50): Record<string, string> {
  const p: Record<string, string> = { limit: String(limit) };
  if (f.state !== "ALL") p["filter[state]"] = f.state;
  if (f.subcontractorId) p["filter[subcontractorId]"] = f.subcontractorId;
  if (f.categoryId) p["filter[categoryId]"] = f.categoryId;
  if (cursor) p.cursor = cursor;
  return p;
}

export async function listCockpit(f: CockpitFilter, cursor: string | null): Promise<SubcontractorCockpitResult> {
  return (await apiClient.get<SubcontractorCockpitResult>("/api/subcontractor/cockpit", { params: cockpitParams(f, cursor) })).data;
}
