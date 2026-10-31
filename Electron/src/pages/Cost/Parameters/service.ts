// Maliyet parametre setleri (`/api/cost/parameter-sets`). Gövde AÇIK alan listesiyle kurulur
// (istemci gövde katmanı sessiz allowlist — alan iki uçta eklenir); sayılar Decimal METNİ gider.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";
import { PARAM_FIELDS, type ParamKey } from "./param-fields";

export type DecText = string | number | null;
export type CostParamStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

export type CostParameterSet = {
  id: string; versionNo: number; status: CostParamStatus; activatedAt: string | null; supersededAt: string | null;
  note: string | null; createdAt: string; updatedAt: string;
  /** SY-D2 atkı ücreti çifti (eski sunucu göndermez → yok sayılır). */
  defaultLoomPickRate?: DecText; defaultLoomPickCurrency?: Currency | null;
} & Record<ParamKey, DecText>;

/** Form değeri (TR yazımı çözülmüş Decimal metni ya da boş) → gövde; yalnız bilinen alanlar. */
export type ParamDraftBody = Partial<Record<ParamKey, string | null>> & {
  note?: string | null; defaultLoomPickRate?: string | null; defaultLoomPickCurrency?: Currency | null;
};

/** `pick` verilmezse çift gövdeye GİRMEZ (sunucu taslaktakini korur) — alan çizilmeyen kurulumda gövde bayt-aynı. */
export function buildParamBody(
  values: Partial<Record<ParamKey, string | null>>, note: string | null | undefined,
  pick?: { rate: string | null; currency: Currency | null },
): ParamDraftBody {
  const out: ParamDraftBody = {};
  for (const f of PARAM_FIELDS) if (f.key in values) out[f.key] = values[f.key] ?? null;
  if (note !== undefined) out.note = note;
  if (pick) {
    out.defaultLoomPickRate = pick.rate;
    out.defaultLoomPickCurrency = pick.currency;
  }
  return out;
}

const BASE = "/api/cost/parameter-sets";

export const costParamService = {
  active: async () => (await apiClient.get<ApiResponse<CostParameterSet | null>>(`${BASE}/active`)).data.data,
  draft: async () => (await apiClient.get<ApiResponse<CostParameterSet | null>>(`${BASE}/draft`)).data.data,
  list: async () => (await apiClient.get<ApiResponse<CostParameterSet[]>>(BASE)).data.data,
  createDraft: async (body: ParamDraftBody) => (await apiClient.post<ApiResponse<CostParameterSet>>(BASE, body)).data,
  updateDraft: async (id: string, body: ParamDraftBody) => (await apiClient.patch<ApiResponse<CostParameterSet>>(`${BASE}/${id}`, body)).data,
  activate: async (id: string) => (await apiClient.post<ApiResponse<CostParameterSet>>(`${BASE}/${id}/activate`, {})).data,
  remove: async (id: string) => (await apiClient.delete<ApiResponse<{ id: string }>>(`${BASE}/${id}`)).data,
};
