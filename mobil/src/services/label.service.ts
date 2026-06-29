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

  /**
   * Rulonun Argox PPLA native komut string'i (text/plain) — Bluetooth yazıcıya
   * ham gönderim için. `/html` ile aynı bağlam (kind + müşteri/stok); profil
   * istasyona göre oto çözülür (x-device-id → machineId).
   */
  getRollPpla: (
    rollId: string,
    kind: 'ROLL_RAW' | 'ROLL_FINISHED',
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean },
  ): Promise<string> =>
    apiClient
      .get<string>(`/labels/rolls/${rollId}/ppla`, {
        params: {
          kind,
          ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
          ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
          ...(ctx?.stock ? { stock: '1' } : {}),
        },
        responseType: 'text',
        transformResponse: [(d) => d],
      })
      .then((r) => String(r.data ?? '')),

  /**
   * Rulonun etiketi SEÇİLİ dilde (cihaz kaydının dili: PPLA/PPLB/ZPL veya
   * RASTER_HTML). Bluetooth yazıcıya ham gönderim için içerik + dil döner.
   * Dil X-Label-Language header'ından okunur; cihaz kaydı yoksa global/model.
   */
  getRollNative: (
    rollId: string,
    kind: 'ROLL_RAW' | 'ROLL_FINISHED',
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean },
  ): Promise<{ content: string; language: string }> =>
    apiClient
      .get<string>(`/labels/rolls/${rollId}/native`, {
        params: {
          kind,
          ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
          ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
          ...(ctx?.stock ? { stock: '1' } : {}),
        },
        responseType: 'text',
        transformResponse: [(d) => d],
      })
      .then((r) => ({
        content: String(r.data ?? ''),
        language: String((r.headers?.['x-label-language'] as string | undefined) ?? 'PPLA'),
      })),

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
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean }
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/labels/rolls/${rollId}/print`, {
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx?.stock ? { stock: true } : {}),
      })
      .then((r) => r.data),

  /**
   * Etiket NİYETİNİ (müşteri/stok) topa kalıcılaştır — fiziksel baskıdan BAĞIMSIZ.
   * LabelPrinter baskı-ÖNCESİ çağırır: yazıcı yok / diyalog iptal olsa bile niyet
   * kaybolmaz. `recordPrintEvent`'ten farkı: LABEL_PRINTED audit'i YAZMAZ (sadece
   * snapshot). Gerçek baskı tamamlanınca ayrıca recordPrintEvent atılır.
   */
  seedSnapshot: (
    rollId: string,
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean }
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/labels/rolls/${rollId}/seed-snapshot`, {
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx?.stock ? { stock: true } : {}),
      })
      .then((r) => r.data),
};
