// Tablet İE Düzelt → "Gramajı Değiştir" uçları (`workOrder.service.ts` satır tavanında olduğu için ayrı dosya).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** `GET /work-orders/:id/kursun-gramaj` — tablet "Gramajı Değiştir" önizlemesi (YAZMAZ). */
export interface KursunGramajPreview {
  propertyId: string | null;
  target: { valueId: string; valueName: string } | null;
  options: { id: string; name: string; isDefault: boolean }[];
  /** Kurşunu eski gramajla uygulanmış toplar (geçmiş değişmez) · yeni gramajın işleyeceği kalan canlı toplar. */
  appliedRollCount: number;
  pendingRollCount: number;
}

export const workOrderGramajApi = {
  kursunGramaj: (id: string): Promise<KursunGramajPreview> =>
    apiClient.get<ApiResponse<KursunGramajPreview>>(`/work-orders/${id}/kursun-gramaj`).then((r) => r.data.data),

  /** Gramajı değiştir — yalnız kurşun hedefi; sebep İE hareket defterine düşer; uygulanmış top varsa `warnings`. */
  changeKursunGramaj: (id: string, data: { propertyId: string; valueId: string; reason: string }): Promise<{ warnings: string[] }> =>
    apiClient
      .put<{ warnings?: string[] }>(`/work-orders/${id}/target-values`, { items: [{ propertyId: data.propertyId, valueId: data.valueId }], reason: data.reason })
      .then((r) => ({ warnings: r.data.warnings ?? [] })),
};
