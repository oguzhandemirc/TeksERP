// =============================================================================
// VARDİYA TANIMI API İSTEMCİSİ — `/api/shift-definitions` (dokuma modülü)
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR ("/api/…"). Bu dosya dokuma uçlarını çağırır ve backend bekçisi
// `test_dokuma_regime_gate §7` onu ADIYLA allowlist'te tutar: karo `dokumaEnabled`e bağlı.
// Gövde backend'de `.strict()` — `code` yalnız doğuşta, `isActive` yalnız arşiv/geri al ile.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ShiftDefinition, ShiftDefinitionFields, ShiftDefinitionPreview, ShiftDefinitionWriteResult } from "./types";

const BASE = "/api/shift-definitions";

export interface ShiftPreviewRequest {
  id: string | null;
  startMinute?: number;
  durationMinutes?: number;
  activeWeekdays?: number[];
  active?: boolean;
}

export const shiftDefinitionService = {
  list: (includeInactive: boolean) =>
    apiClient.get<ApiResponse<ShiftDefinition[]>>(`${BASE}${includeInactive ? "?includeInactive=1" : ""}`).then((r) => r.data),
  create: (body: ShiftDefinitionFields & { code: string }) =>
    apiClient.post<ApiResponse<ShiftDefinitionWriteResult>>(BASE, body).then((r) => r.data),
  update: (id: string, body: Partial<ShiftDefinitionFields>) =>
    apiClient.patch<ApiResponse<ShiftDefinitionWriteResult>>(`${BASE}/${id}`, body).then((r) => r.data),
  archive: (id: string) => apiClient.post<ApiResponse<ShiftDefinitionWriteResult>>(`${BASE}/${id}/archive`, {}).then((r) => r.data),
  restore: (id: string) => apiClient.post<ApiResponse<ShiftDefinitionWriteResult>>(`${BASE}/${id}/restore`, {}).then((r) => r.data),
  /** Yazmaz: kaydedilirse takvimde hangi pencere doğar / değişir / iptal olur. */
  preview: (body: ShiftPreviewRequest) => apiClient.post<ApiResponse<ShiftDefinitionPreview>>(`${BASE}/preview`, body).then((r) => r.data),
};
