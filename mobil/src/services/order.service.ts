import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { Order } from '../types/models';

// =============================================================================
// Sipariş servisleri — Tambur "Kime?" picker'ı + sipariş bağı yardımcıları.
// L fix (2026-06-13): ReadyOrder/getReadyOrders kaldırıldı — backend'de hiç
// var olmayan /shipping/ready-orders'a (eski, silinen sevkiyat tasarımının
// kalıntısı) gidiyordu; hiçbir ekran çağırmıyordu.
// =============================================================================

/** Bir topun özelliğine uyan açık sipariş kalemi (Açık>0). Tambur yeniden-kes "Kime?" picker'ı. */
export interface AvailableOrderLine {
  lineId: string;
  /** Kalemin ürünü — sipariş-önce'de WO ürününü kilitler + anchor (tek WO=tek kumaş). */
  itemId: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  branchName: string | null;
  itemCode: string;
  itemName: string;
  customerItemName: string | null;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  customerColorName: string | null;
  width: number | null;
  quantity: number;
  /** Açık = istenen − sevk. KG/ADET satırda `null` — karşılama metre defterinden ölçülmez. */
  openQty: number | null;
  /** Yalnız withInProduction istendiğinde dolar (Hızlı İş Emri). */
  inProduction?: number;
  /** Net açık = açık − üretimdeki (withInProduction). Yoksa openQty kullan. `openQty` null ise null. */
  netOpenQty?: number | null;
  /** `openQty` ölçülüyor mu (`unit === MT`). Eski backend göndermez → ölçülür sayılır. */
  measured?: boolean;
  /**
   * Bu KALEME (spec havuzuna değil) canlı bir iş emri bağlı mı — iptal/devredilmiş
   * WO sayılmaz. Yalnız cursor modda döner. `inProduction` ile karıştırma: o,
   * aynı kumaş+renk+en havuzundaki BAŞKA kalemler yüzünden de dolu olabilir.
   */
  hasWorkOrder?: boolean;
}

/** Cursor (keyset) sayfa cevabı — "sipariş-önce" aramalı liste infinite scroll. */
export interface AvailableOrderLinesCursorPage {
  success: boolean;
  data: AvailableOrderLine[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface QuickOrderResult {
  order: { id: string; orderNumber: string };
  lineCount: number;
  rollCount: number;
  preparedToWarehouse: number;
}

/**
 * "Yeni Sipariş" ekranının gönderdiği kalem. Kapsam BİLİNÇLİ olarak dardır
 * (2026-08-04 ürün kararı): müşterideki kumaş/renk adı override'ı, özellik ve
 * fiyat telefondan GİRİLMEZ. Override boş bırakıldığında backend etkin adı
 * `CustomerItemAlias`/`CustomerColorAlias` master'ından CANLI çözer — telefondan
 * yazılan bir değer o bağı dondururdu (bkz. schema.prisma OrderLine yorumu).
 */
export interface NewOrderLine {
  itemId: string;
  colorId: string | null;
  /** Metre. */
  quantity: number;
  /** İstenen en (cm) — opsiyonel. */
  width: number | null;
}

export interface NewOrderPayload {
  customerId: string;
  /** Şube bayrağı kapalıysa HİÇ gönderilmez (undefined) — null "şube yok" demek. */
  branchId?: string | null;
  /** ISO tarih. Verilmezse backend `order.defaultDeadlineDays` ile hesaplar. */
  deadline?: string;
  lines: NewOrderLine[];
  /** İdempotency anahtarı — timeout-replay'de mükerrer sipariş önlenir. */
  clientToken: string;
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
}

/** Cursor (keyset) sayfa cevabı — sipariş listesi infinite scroll. */
export interface OrderCursorPage {
  success: boolean;
  data: Order[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    /** Yalnız ilk sayfada (`withTotal`) ve YAKLAŞIKtır. */
    totalEstimate?: number;
  };
}

/** Spec (kumaş+renk+en) anlık müsaitlik — sipariş formu ipucu (metre). REZERV DEĞİL. */
export interface SpecAvailability {
  freeWarehouse: number;
  inProduction: number;
  freeStock: number;
}

export const orderService = {
  /** Özelliğe (itemId + opsiyonel colorId/width) uyan açık sipariş kalemleri. */
  getAvailableOrderLines: (params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
    /** true → satırlara inProduction + netOpenQty eklenir (Hızlı İş Emri). */
    withInProduction?: boolean;
  }): Promise<ApiResponse<AvailableOrderLine[]>> => {
    const q = new URLSearchParams({ itemId: params.itemId });
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.width != null) q.set('width', String(params.width));
    if (params.withInProduction) q.set('withInProduction', 'true');
    return apiClient
      .get<ApiResponse<AvailableOrderLine[]>>(`/orders/order-lines/available?${q.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Açık sipariş kalemleri — cursor (keyset) + BACKEND araması (sipariş no /
   * müşteri / ürün / müşteri ürün adı; `buildTurkishSearch`).
   *
   * `itemId` opsiyonel: verilirse o kumaşın kalemleri (top-önce), verilmezse tüm
   * açık kalemler (sipariş-önce). Hızlı İş Emri picker'ı İKİ durumda da bunu
   * kullanır — sayfasız varyant (`getAvailableOrderLines`) sınırsız payload
   * döndürüyordu ve aramayı hiç desteklemiyordu.
   *
   * `withInProduction` yalnız `itemId` ile anlamlıdır (havuz kumaş bazlı); broad
   * modda backend zaten atlar.
   */
  getAvailableOrderLinesCursor: (params: {
    itemId?: string | null;
    search?: string | null;
    cursor?: string | null;
    limit?: number;
    withTotal?: boolean;
    withInProduction?: boolean;
    customerId?: string | null;
    colorId?: string | null;
    /** En (cm) süzgeci — Tambur "Sipariş Bağla" modalı (2026-08-19). */
    width?: number | null;
    /**
     * "Bu kalemle aynı iş emrinde üretilebilecekler" — backend verilen satırın
     * spec'ini (kumaş + renk + en) okuyup listeyi ona daraltır; kumaş/renk/en
     * parametrelerini EZER. Uyumsuz kalemler istemciye hiç inmez.
     */
    specOfLineId?: string | null;
  }): Promise<AvailableOrderLinesCursorPage> => {
    const q = new URLSearchParams();
    if (params.itemId) q.set('itemId', params.itemId);
    if (params.customerId) q.set('customerId', params.customerId);
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.width != null) q.set('width', String(params.width));
    if (params.specOfLineId) q.set('specOfLineId', params.specOfLineId);
    if (params.search) q.set('search', params.search);
    if (params.cursor) q.set('cursor', params.cursor);
    q.set('limit', String(params.limit ?? 20));
    if (params.withTotal) q.set('withTotal', 'true');
    if (params.withInProduction) q.set('withInProduction', 'true');
    return apiClient
      .get<AvailableOrderLinesCursorPage>(`/orders/order-lines/available?${q.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Sipariş listesi — cursor (keyset) + infinite scroll (mobil sayfalama
   * standardı; offset modeli `MAX_OFFSET=10000` guard'ına takılır ve her
   * sayfada COUNT(*) koşar).
   *
   * Yanıt `defaultInclude` ile customer + branch + lines TAŞIR, bu yüzden detay
   * sayfası için ayrı istek YOK — sheet listedeki satırdan çizer.
   */
  listCursor: (params: {
    cursor?: string | null;
    limit?: number;
    search?: string | null;
    status?: string | null;
    customerId?: string | null;
    withTotal?: boolean;
  }): Promise<OrderCursorPage> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    sp.set('limit', String(params.limit ?? 20));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.search) sp.set('search', params.search);
    if (params.status) sp.set('filter[status]', params.status);
    if (params.customerId) sp.set('filter[customerId]', params.customerId);
    if (params.withTotal) sp.set('withTotal', 'true');
    // En yeni sipariş üstte — satış ekranında beklenen sıra.
    sp.set('sortBy', 'createdAt');
    sp.set('sortOrder', 'desc');
    return apiClient.get<OrderCursorPage>(`/orders?${sp.toString()}`).then((r) => r.data);
  },

  /**
   * Yeni müşteri siparişi (mobil sihirbaz). Backend `POST /orders` — sipariş
   * numarasını SUNUCU üretir (SIP+GGAAYY+NNNN), bu yüzden offline kuyruğa
   * ALINMAZ; ekran çevrimdışıyken gönderimi kapatır.
   */
  create: (data: NewOrderPayload): Promise<ApiResponse<CreatedOrder>> =>
    apiClient.post<ApiResponse<CreatedOrder>>('/orders', data).then((r) => r.data),

  /** Kumaş+renk+en için depo/üretim/ham metrajı — kalem eklerken ipucu. */
  getSpecAvailability: (params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<ApiResponse<SpecAvailability>> => {
    const q = new URLSearchParams({ itemId: params.itemId });
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.width != null) q.set('width', String(params.width));
    return apiClient
      .get<ApiResponse<SpecAvailability>>(`/orders/spec-availability?${q.toString()}`)
      .then((r) => r.data);
  },

  /** Saha #11: ham/stok toplardan hızlı sipariş (okut→müşteri→otomatik satır). */
  quickFromRolls: (data: {
    customerId: string;
    branchId?: string | null;
    rollIds: string[];
    /** İdempotency anahtarı — timeout-replay'de mükerrer sipariş önlenir. */
    clientToken?: string;
  }): Promise<ApiResponse<QuickOrderResult>> =>
    apiClient.post<ApiResponse<QuickOrderResult>>('/orders/quick-from-rolls', data).then((r) => r.data),
};
