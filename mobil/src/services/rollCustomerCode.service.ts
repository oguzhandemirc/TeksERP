import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** `RollCustomerCode` satırının tablette kullanılan kesiti (D4-F1 bağla ucu yanıtı). */
export interface BoundCustomerCode {
  id: string;
  rollId: string;
  customerId: string;
  code: string;
}

export const rollCustomerCodeService = {
  /** Müşterinin önbasılı etiketini emanet topa bağlar; `clientToken` mantıksal deneme başına (aynı token = replay). */
  bind: (rollId: string, body: { code: string; clientToken: string }): Promise<ApiResponse<BoundCustomerCode>> =>
    apiClient.post<ApiResponse<BoundCustomerCode>>(`/rolls/${rollId}/customer-code`, body).then((r) => r.data),

  /** Aktif kodu sebebiyle kaldırır (satır silinmez, damgalanır). Değiştirme = kaldır + bağla. */
  revoke: (rollId: string, reason: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/rolls/${rollId}/customer-code/revoke`, { reason }).then((r) => r.data),
};
