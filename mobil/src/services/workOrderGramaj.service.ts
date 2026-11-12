// Tablet İE Düzelt → "Gramajı Değiştir" + "Hedef değeri değiştir" + "Kat Tipini Değiştir" uçları (`workOrder.service.ts` satır tavanında olduğu için ayrı dosya).
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

export const workOrderGramajService = {
  kursunGramaj: (id: string): Promise<KursunGramajPreview> =>
    apiClient.get<ApiResponse<KursunGramajPreview>>(`/work-orders/${id}/kursun-gramaj`).then((r) => r.data.data),

  /** Gramajı değiştir — yalnız kurşun hedefi; sebep İE hareket defterine düşer; uygulanmış top varsa `warnings`. */
  changeKursunGramaj: (id: string, data: { propertyId: string; valueId: string; reason: string }): Promise<{ warnings: string[] }> =>
    apiClient
      .put<{ warnings?: string[] }>(`/work-orders/${id}/target-values`, { items: [{ propertyId: data.propertyId, valueId: data.valueId }], reason: data.reason })
      .then((r) => ({ warnings: r.data.warnings ?? [] })),

  /**
   * Hedef değeri değiştir (kurşun dışı çeşit değeri) — `correction: true` panel izinli kullanıcıda da tablet kurallarını
   * açar: sebep zorunlu, değerin adımı başladıysa sunucu 409 `TARGET_VALUE_STEP_STARTED`.
   */
  changeTargetValue: (id: string, data: { propertyId: string; valueId: string; reason: string; reasonCode?: string | null }): Promise<{ warnings: string[] }> =>
    apiClient
      .put<{ warnings?: string[] }>(`/work-orders/${id}/target-values`, {
        items: [{ propertyId: data.propertyId, valueId: data.valueId }],
        reason: data.reason,
        ...(data.reasonCode ? { reasonCode: data.reasonCode } : {}),
        correction: true,
      })
      .then((r) => ({ warnings: r.data.warnings ?? [] })),

  /** Kat Tipini Değiştir — sebep zorunlu; Tambur başladıysa sunucu 409 (kat kilitli). */
  changeFoldType: (id: string, data: { foldType: string | null; reason: string; reasonCode?: string | null }): Promise<void> =>
    apiClient
      .patch(`/work-orders/${id}/fold-type`, {
        foldType: data.foldType,
        reason: data.reason,
        ...(data.reasonCode ? { reasonCode: data.reasonCode } : {}),
      })
      .then(() => undefined),
};
