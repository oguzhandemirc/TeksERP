import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type {
  LabelPayload,
  NameSource,
  SwatchLabelPayload,
  UpdateOrderLineCustomerNamesRequest,
} from '../types/models';

/** `GET /labels/name-preview` yanıtı — kesimden ÖNCE "etikette ne yazacak". */
export interface LabelNamePreview {
  itemId: string;
  colorId: string | null;
  customerId: string | null;
  customerName: string | null;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: NameSource;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: NameSource | null;
}

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
   * Rulonun etiketi SEÇİLİ dilde (cihaz kaydının dili: PPLA/PPLB/ZPL veya
   * RASTER_HTML). Bluetooth yazıcıya ham gönderim için içerik + dil döner.
   * Dil X-Label-Language header'ından okunur; cihaz kaydı yoksa global/model.
   */
  getRollNative: (
    rollId: string,
    kind: 'ROLL_RAW' | 'ROLL_FINISHED',
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean; confirmScrap?: boolean },
    rasterCapable?: boolean,
  ): Promise<{ content: string; encoding: 'text' | 'base64'; language: string }> => {
    const params = {
      kind,
      ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
      ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
      ...(ctx?.stock ? { stock: '1' } : {}),
      ...(ctx?.confirmScrap ? { confirmScrap: '1' } : {}),
    };
    // rasterCapable (mobileRasterEnabled) → encoding=b64: backend cihazın rasterMode'unu
    // ONURLANDIRIR → raster GW bitmap (ya da komut), ikisi de base64 byte olarak JSON döner.
    // rasterCapable false → eski ham-text komut yolu (byte-birebir latin1).
    if (rasterCapable) {
      return apiClient
        .get<{ success: boolean; data: { content: string; encoding: string; language: string } }>(
          `/labels/rolls/${rollId}/native`,
          { params: { ...params, encoding: 'b64' } },
        )
        .then((r) => ({
          content: r.data?.data?.content ?? '',
          encoding: 'base64' as const,
          language: String(r.data?.data?.language ?? 'PPLA'),
        }));
    }
    return apiClient
      .get<string>(`/labels/rolls/${rollId}/native`, {
        params,
        responseType: 'text',
        transformResponse: [(d) => d],
      })
      .then((r) => ({
        content: String(r.data ?? ''),
        encoding: 'text' as const,
        language: String((r.headers?.['x-label-language'] as string | undefined) ?? 'PPLA'),
      }));
  },

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
  // ── ÇUVAL ETİKETİ — barkod/QR = Sack.sackNo (tek kod) ──────────────────────
  // Şablon (SACK bağlam varsayılanı) atanmamışsa backend 400 döner ve HATA MESAJI
  // operatöre ne yapacağını söyler — roll etiketine SAPMAZ (fail-closed).

  /**
   * Çuval etiketi SEÇİLİ yazıcı dilinde. rasterCapable → base64 JSON zarfı;
   * yoksa ham text komut (roll `/native` ile aynı sözleşme).
   */
  getSackNative: (
    sackId: string,
    rasterCapable?: boolean
  ): Promise<{ content: string; encoding: 'text' | 'base64'; language: string }> => {
    if (rasterCapable) {
      return apiClient
        .get<{ success: boolean; data: { content: string; encoding: string; language: string } }>(
          `/labels/sacks/${sackId}/native`,
          { params: { encoding: 'b64' } }
        )
        .then((r) => ({
          content: r.data.data.content,
          encoding: 'base64' as const,
          language: r.data.data.language,
        }));
    }
    return apiClient
      .get<string>(`/labels/sacks/${sackId}/native`, { responseType: 'text' })
      .then((r) => ({
        content: r.data,
        encoding: 'text' as const,
        language: String(r.headers['x-label-language'] ?? ''),
      }));
  },

  /** Çuval etiketinin tam HTML'i — BT yazıcı yokken expo-print fallback'i. */
  getSackHtml: (sackId: string): Promise<string> =>
    apiClient.get<string>(`/labels/sacks/${sackId}/html`, { responseType: 'text' }).then((r) => r.data),

  /** Çuval etiketi baskı izi — yalnız GERÇEK baskı tamamlanınca. */
  recordSackPrintEvent: (sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/labels/sacks/${sackId}/print-event`, {}).then((r) => r.data),

  recordPrintEvent: (
    rollId: string,
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean; confirmScrap?: boolean }
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/labels/rolls/${rollId}/print`, {
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx?.stock ? { stock: true } : {}),
        ...(ctx?.confirmScrap ? { confirmScrap: true } : {}),
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
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean; confirmScrap?: boolean }
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/labels/rolls/${rollId}/seed-snapshot`, {
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx?.stock ? { stock: true } : {}),
        ...(ctx?.confirmScrap ? { confirmScrap: true } : {}),
      })
      .then((r) => r.data),

  /**
   * TOPLU etiket hedefi (2026-08-09) — "kuşağı değişen ürünlerin toplu etiket
   * çıkarıp yenilenmesi" saha isteği.
   *
   * ⚠️ Sonuç PARÇALIDIR: `failed[]` atlanan her topu barkodu ve SEBEBİYLE döner.
   * Ekran bunu YUTMAMALI — "42 yazıldı" deyip 8'inin neden atlandığını
   * söylememek en kötü davranıştır.
   */
  seedSnapshotBulk: (
    rollIds: string[],
    ctx?: { orderLineId?: string | null; customerId?: string | null; stock?: boolean; confirmScrap?: boolean }
  ): Promise<
    ApiResponse<{
      seeded: string[];
      failed: Array<{ rollId: string; barcode: string | null; reason: string }>;
    }>
  > =>
    apiClient
      .post<
        ApiResponse<{
          seeded: string[];
          failed: Array<{ rollId: string; barcode: string | null; reason: string }>;
        }>
      >('/labels/rolls/seed-snapshot-bulk', {
        rollIds,
        ...(ctx?.orderLineId ? { orderLineId: ctx.orderLineId } : {}),
        ...(ctx?.customerId ? { customerId: ctx.customerId } : {}),
        ...(ctx?.stock ? { stock: true } : {}),
        ...(ctx?.confirmScrap ? { confirmScrap: true } : {}),
      })
      .then((r) => r.data),

  /**
   * "Bu hedefe basarsam etikette hangi AD çıkar?" — top DOĞMADAN önce (2026-08-13).
   * Zincir backend'de çözülür (sipariş override'ı → müşteri alias'ı → bizdeki ad);
   * istemci onu TEKRAR YAZMAZ, yoksa önizleme ile basılan etiket ayrışır.
   */
  previewCustomerNames: (params: {
    rollId: string;
    orderLineId?: string | null;
    customerId?: string | null;
  }): Promise<ApiResponse<LabelNamePreview>> =>
    apiClient
      .get<ApiResponse<LabelNamePreview>>('/labels/name-preview', {
        params: {
          rollId: params.rollId,
          ...(params.orderLineId ? { orderLineId: params.orderLineId } : {}),
          ...(params.customerId ? { customerId: params.customerId } : {}),
        },
      })
      .then((r) => r.data),

  /**
   * KALICI müşteri adı (master alias) — bu müşteride bu kumaş/renk BUNDAN SONRA
   * hep böyle basılır. `customer-alias:write` ister.
   *
   * ⚠️ Sipariş satırı override'ı (`updateOrderLineCustomerNames`) ile KARIŞTIRMA:
   * o yalnız O SİPARİŞ için geçerlidir ve zincirde alias'ın ÖNÜNDE gelir — yani
   * satırda override varken alias'ı düzeltmek etiketi DEĞİŞTİRMEZ.
   */
  setCustomerItemAlias: (
    customerId: string,
    itemId: string,
    alias: string,
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .put<ApiResponse<unknown>>(`/customers/${customerId}/item-aliases/${itemId}`, { alias })
      .then((r) => r.data),

  setCustomerColorAlias: (
    customerId: string,
    colorId: string,
    alias: string,
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .put<ApiResponse<unknown>>(`/customers/${customerId}/color-aliases/${colorId}`, { alias })
      .then((r) => r.data),
};
