import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type {
  LabelPayload,
  SwatchLabelPayload,
  UpdateOrderLineCustomerNamesRequest,
} from '../types/models';

// =============================================================================
// Label endpoints — effective name cascade ile payload + audit print + override
// =============================================================================
// Cascade: OrderLine.customerItemName → CustomerItemAlias.alias → Item.name
// Aynı sıra color için. customerName null ise frontend müşteri bloğunu render
// etmez (boş alan yerine satır komple gizlenir).
// =============================================================================

export const labelService = {
  /** Rulonun etiket payload'unu effective name cascade ile döner. */
  getRollLabel: (rollId: string): Promise<ApiResponse<LabelPayload>> =>
    apiClient
      .get<ApiResponse<LabelPayload>>(`/labels/rolls/${rollId}`)
      .then((r) => r.data),

  /** Kartelanın etiket payload'u — parentRoll allocation üzerinden cascade. */
  getSwatchLabel: (swatchId: string): Promise<ApiResponse<SwatchLabelPayload>> =>
    apiClient
      .get<ApiResponse<SwatchLabelPayload>>(`/labels/swatches/${swatchId}`)
      .then((r) => r.data),

  /**
   * OrderLine.customerItemName / customerColorName 1-shot override. Boş string
   * veya null gönderilirse override silinir → master/default'a düşer.
   * UYARI: Sipariş satırına bağlı TÜM ruloları etkiler.
   */
  updateOrderLineCustomerNames: (
    orderLineId: string,
    data: UpdateOrderLineCustomerNamesRequest
  ): Promise<
    ApiResponse<{
      orderLineId: string;
      customerItemName: string | null;
      customerColorName: string | null;
    }>
  > =>
    apiClient
      .patch<
        ApiResponse<{
          orderLineId: string;
          customerItemName: string | null;
          customerColorName: string | null;
        }>
      >(`/labels/order-lines/${orderLineId}`, data)
      .then((r) => r.data),

  /**
   * Etiket basıldı audit event'i + "son basılan etiket" snapshot'ı. Asıl baskı
   * tarayıcı/yazıcıda gerçekleşir; bu çağrı SystemLog izi düşer ve baskı
   * bağlamını (orderLineId/customerId) backend'e bildirir (snapshot için).
   */
  recordPrintEvent: (
    rollId: string,
    ctx?: { orderLineId?: string | null; customerId?: string | null }
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/labels/rolls/${rollId}/print`, {
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
      })
      .then((r) => r.data),
};
