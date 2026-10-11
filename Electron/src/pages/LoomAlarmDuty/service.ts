// =============================================================================
// ALARM SORUMLULARI API İSTEMCİSİ — `/api/loom-alarm-duty`
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR ("/api/…"). Kapı: tezgah modülü ∧ alarm bayrağı ∧ `loom:spec-manage`.
// Gövdeler backend'de `.strict()`; `clientToken` çağıranın denemesinden gelir (burada üretilmez).
// Kaldırma silme değildir: `revokedAt` damgası (yapılandırma geçmişi kalır).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  DutyCandidate,
  DutyOverride,
  DutyOverview,
  DutyOptions,
  DutyResponsible,
  DutyRule,
  DutyShiftInstance,
  OverrideBody,
  ResponsibleBody,
  RuleBody,
} from "./types";

const BASE = "/api/loom-alarm-duty";
export type DutyKind = "responsibles" | "overrides" | "rules";

const get = <T>(path: string): Promise<T> =>
  apiClient.get<ApiResponse<T>>(path, { suppressErrorToast: true }).then((r) => r.data.data);
const post = <T>(path: string, body: object): Promise<ApiResponse<T>> =>
  apiClient.post<ApiResponse<T>>(path, body, { suppressErrorToast: true }).then((r) => r.data);

export const loomAlarmDutyService = {
  overview: () => get<DutyOverview>(BASE),
  candidates: () => get<DutyCandidate[]>(`${BASE}/candidates`),
  options: () => get<DutyOptions>(`${BASE}/options`),
  /** Varsayılan pencere bugün + 8 gün (sunucu). */
  shiftInstances: () => get<DutyShiftInstance[]>(`${BASE}/shift-instances`),
  createResponsible: (body: ResponsibleBody, clientToken: string) =>
    post<DutyResponsible>(`${BASE}/responsibles`, { ...body, clientToken }),
  createOverride: (body: OverrideBody, clientToken: string) =>
    post<DutyOverride>(`${BASE}/overrides`, { ...body, clientToken }),
  createRule: (body: RuleBody, clientToken: string) => post<DutyRule>(`${BASE}/rules`, { ...body, clientToken }),
  revoke: (kind: DutyKind, id: string) => post<{ id: string; revokedAt: string }>(`${BASE}/${kind}/${id}/revoke`, {}),
};
