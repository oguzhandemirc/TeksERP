// =============================================================================
// MAKİNE KARTLARI API İSTEMCİSİ — `/api/machine-collectors` (D3a)
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR. Kapı: tezgah modülü ∧ `loom:spec-manage`. Sır yalnız `create`/`rotateSecret`
// dönüşünde gelir; çağıran onu React Query önbelleğine KOYMAZ (yerel state, pencere kapanınca silinir).
// Hata toast'u apiClient'tadır (4xx backend mesajı) — çağıran ikinci toast basmaz.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CollectorBody, CollectorWithSecret, MachineCollector } from "./types";

const BASE = "/api/machine-collectors";

export const machineCollectorService = {
  list: () => apiClient.get<ApiResponse<MachineCollector[]>>(BASE).then((r) => r.data.data),
  /** İptal önizlemesi de bu taze okumadır: o anki bağlı tezgahlar. */
  get: (id: string) => apiClient.get<ApiResponse<MachineCollector>>(`${BASE}/${id}`).then((r) => r.data.data),
  create: (body: CollectorBody) => apiClient.post<ApiResponse<CollectorWithSecret>>(BASE, body).then((r) => r.data.data),
  update: (id: string, body: Partial<CollectorBody>) =>
    apiClient.patch<ApiResponse<MachineCollector>>(`${BASE}/${id}`, body).then((r) => r.data.data),
  rotateSecret: (id: string) =>
    apiClient.post<ApiResponse<CollectorWithSecret>>(`${BASE}/${id}/rotate-secret`, {}).then((r) => r.data.data),
  revoke: (id: string) => apiClient.post<ApiResponse<MachineCollector>>(`${BASE}/${id}/revoke`, {}).then((r) => r.data.data),
};
