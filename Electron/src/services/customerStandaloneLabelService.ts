// =============================================================================
// Müşteri ↔ Serbest etiket bağı (CustomerStandaloneLabel — M:N kolaylık bağı)
// =============================================================================
// KIND-bazlı CustomerTemplateRoute'tan (labelTemplateService.ts) AYRIDIR: bu bağ
// rulo/kartela baskı çözümüne KATILMAZ. Bağ opsiyonel — hiç müşteriye bağlanmayan
// serbest etiket "genel"dir ve Serbest Baskı ekranında her müşteride görünür.
// Ayrı modül: labelTemplateService.ts zaten 300+ satır (etiket-domain'i şişkin).

import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export interface StandaloneLabelLink {
  id: string;
  name: string;
}

export const customerStandaloneLabelService = {
  /** Bu müşteriye bağlı AKTİF serbest etiketler (yalnız id + ad). */
  list: (customerId: string): Promise<StandaloneLabelLink[]> =>
    apiClient
      .get<ApiResponse<StandaloneLabelLink[]>>(`/api/customers/${customerId}/standalone-labels`)
      .then((r) => r.data.data),

  /**
   * Replace-set — müşterinin bağlı serbest etiketlerini `templateIds` ile
   * değiştirir (eksikler silinir, yeniler eklenir). Backend her id'yi aktif
   * serbest etiket olarak doğrular; değilse 400.
   */
  set: (customerId: string, templateIds: string[]): Promise<void> =>
    apiClient
      .put(`/api/customers/${customerId}/standalone-labels`, { templateIds })
      .then(() => undefined),
};
