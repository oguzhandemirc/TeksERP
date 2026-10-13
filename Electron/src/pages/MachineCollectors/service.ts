// =============================================================================
// MAKİNE KARTLARI API İSTEMCİSİ — `/api/machine-collectors` (D3a)
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR. Kapı: tezgah modülü ∧ `loom:spec-manage`. Sır yalnız `create`/`rotateSecret`
// dönüşünde gelir; çağıran onu React Query önbelleğine KOYMAZ (yerel state, pencere kapanınca silinir).
// Hata toast'u apiClient'tadır (4xx backend mesajı) — çağıran ikinci toast basmaz.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CollectorBody, CollectorCreateBody, CollectorCreateResult, CollectorRevokePreview, CollectorWithSecret, MachineCollector } from "./types";

const BASE = "/api/machine-collectors";

export const machineCollectorService = {
  list: () => apiClient.get<ApiResponse<MachineCollector[]>>(BASE).then((r) => r.data.data),
  get: (id: string) => apiClient.get<ApiResponse<MachineCollector>>(`${BASE}/${id}`).then((r) => r.data.data),
  /** İptal önizlemesi — sunucu ucu: bağı çözülecek tezgahlar · kartın açık duruşları · bekleyen geç kapanışlar. */
  revokePreview: (id: string) =>
    apiClient.get<ApiResponse<CollectorRevokePreview>>(`${BASE}/${id}/revoke/preview`).then((r) => r.data.data),
  /** Replay'de (aynı token) `secret: null` + `secretWithheld` döner — sır yeniden gösterilmez. */
  create: (body: CollectorCreateBody) => apiClient.post<ApiResponse<CollectorCreateResult>>(BASE, body).then((r) => r.data.data),
  update: (id: string, body: Partial<CollectorBody>) =>
    apiClient.patch<ApiResponse<MachineCollector>>(`${BASE}/${id}`, body).then((r) => r.data.data),
  rotateSecret: (id: string) =>
    apiClient.post<ApiResponse<CollectorWithSecret>>(`${BASE}/${id}/rotate-secret`, {}).then((r) => r.data.data),
  revoke: (id: string) => apiClient.post<ApiResponse<MachineCollector>>(`${BASE}/${id}/revoke`, {}).then((r) => r.data.data),
};
