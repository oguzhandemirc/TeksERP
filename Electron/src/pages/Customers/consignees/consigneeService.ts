// Etiket alıcısı kataloğu (2026-11-10) — müşterimizin müşterisi; emanet topun etiketine basılan ad.
// Uçlar backend `customer-consignee.routes.ts`; panel 409'ları kendisi çizer (`suppressErrorToast`).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface ConsigneeRow {
  id: string;
  customerId: string;
  name: string;
  isActive: boolean;
  labelTemplateId: string | null;
  labelTemplate: { id: string; name: string } | null;
  lastUsedAt: string | null;
  liveRollCount: number;
}

/** Canlı top (birleştirmede hedefe döner / pasife almayı engeller) — backend `liveRollsOf`. */
export interface ConsigneeLiveRoll {
  id: string;
  barcode: string | null;
  meters: number;
  status: string;
  printed: boolean;
}

export interface ConsigneeMergePreview {
  source: { id: string; name: string };
  target: { id: string; name: string; isActive: boolean };
  rolls: ConsigneeLiveRoll[];
  /** Sevk edilmiş / kilitli toplar — basılı adları değişmez, yalnız sayı. */
  untouchedRollCount: number;
}

const quiet = { suppressErrorToast: true } as const;

export const consigneeService = {
  list: (customerId: string): Promise<ConsigneeRow[]> =>
    apiClient
      .get<ApiResponse<ConsigneeRow[]>>(`/api/customers/${customerId}/consignees`, { params: { includeInactive: "true" } })
      .then((r) => r.data.data ?? []),
  rename: (id: string, name: string) => apiClient.patch(`/api/customer-consignees/${id}`, { name }, quiet),
  deactivate: (id: string) => apiClient.post(`/api/customer-consignees/${id}/deactivate`, {}, quiet),
  activate: (id: string) => apiClient.post(`/api/customer-consignees/${id}/activate`, {}),
  setTemplate: (id: string, labelTemplateId: string | null) =>
    apiClient.put(`/api/customer-consignees/${id}/label-template`, { labelTemplateId }),
  mergePreview: (id: string, targetId: string): Promise<ConsigneeMergePreview> =>
    apiClient
      .get<ApiResponse<ConsigneeMergePreview>>(`/api/customer-consignees/${id}/merge-preview`, { params: { targetId } })
      .then((r) => r.data.data as ConsigneeMergePreview),
  merge: (id: string, targetId: string) => apiClient.post(`/api/customer-consignees/${id}/merge`, { targetId }),
};
