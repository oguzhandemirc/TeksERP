import { apiClient } from './api';
import type { ApiResponse, CursorPaginatedResponse } from '../types/api';

// =============================================================================
// Tartı/Paket + Sevkiyat — GEVŞEK MODEL sözleşmesi (/api/shipping)
// Sevkiyat oturumu = tek müşteri+şube + seçilen siparişler + okutulan toplar +
// çuval tartıları + İÇERİK (çuval-önce: topu aktif çuvala okut). Karşılanma spec-toplam.
// =============================================================================

export type ShipmentStatus = 'PREPARING' | 'READY' | 'AT_DOOR' | 'DISPATCHED' | 'CANCELLED';
/** Saha #19+#22: yurtiçi/yurtdışı sevkiyat kapsamı. */
export type ShipmentDestination = 'DOMESTIC' | 'EXPORT';
export const shipmentDestinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: 'Yurtiçi',
  EXPORT: 'Yurtdışı',
};

export const SHIPMENT_STATUS_TR: Record<ShipmentStatus, string> = {
  PREPARING: 'Hazırlanıyor',
  READY: 'Çuval Depo',
  AT_DOOR: 'Kapı Önü',
  DISPATCHED: 'Sevk Edildi',
  CANCELLED: 'İptal',
};

interface Ref {
  id: string;
  code?: string;
  name: string;
}

// ── Sipariş seçim ekranı (open-orders + depo karşılaması) ──
export interface OpenOrderLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  openQty: number;
  warehouseAvailable: number;
  covered: boolean;
}
export interface OpenOrder {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    deadline: string | null;
    customer: Ref;
    branch: { id: string; name: string } | null;
    /** Doluysa sipariş zaten aktif bir sevkiyatta → ekranda "Sürdür". */
    activeShipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  };
  lines: OpenOrderLine[];
}

// ── Sevkiyat detayı (paketleme ekranı) ──
export interface ShipmentDetailLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  openQty: number;
  thisShipment: number;
}
export interface ShipmentDetailOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
  lines: ShipmentDetailLine[];
}
export interface ShipmentDetailRoll {
  id: string;
  barcode: string | null;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
  width: number | null;
  currentQty: number;
  /** İçinde bulunduğu çuval (top-level rolls'da döner). */
  sackId?: string | null;
}

/** Çuval içeriğindeki top (sack.rolls). */
export interface SackRoll {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
}
export interface SackSwatch {
  id: string;
  barcode: string | null;
  length: number | null;
  width: number | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
}
export interface SackProductSummary {
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  totalQty: number;
  rollCount: number;
}
export interface ShipmentSack {
  id: string;
  sackNo: string;
  seq: number;
  /** Operatörün çuval üstüne elle yazdığı kod (sevke hazır/sevk için zorunlu). */
  manualCode: string | null;
  weightKg: number | null;
  rolls: SackRoll[];
  swatches: SackSwatch[];
  productSummary: SackProductSummary[];
  rollCount: number;
  swatchCount: number;
}
/** addSack lean dönüşü — yeni açılan boş çuval (içerik yok). */
export interface ShipmentSackLean {
  id: string;
  sackNo: string;
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
}
/** Bu sevkiyattan iade edilmiş top (canlı rolls'ta yok; RollReturn'den). */
export interface ShipmentReturnedRoll {
  id: string;
  barcode: string | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
  width: number | null;
  qty: number;
  returnedAt: string;
  reasonName: string | null;
  reasonColor: string | null;
}
export interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  destination: ShipmentDestination;
  procedureCode: string | null;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  customer: Ref;
  branch: { id: string; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: Array<{ id: string; barcode: string | null; length: number; width: number | null }>;
  sacks: ShipmentSack[];
  returnedRolls: ShipmentReturnedRoll[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
    returnedCount: number;
    returnedMeters: number;
  };
}

export interface ShipmentListItem {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  customer: Ref;
  branch: { id: string; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number };
}

export interface ShipmentCancelPreview {
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  customerName: string;
  branchName: string | null;
  canCancel: boolean;
  reason: string | null;
  rolls: Array<{ id: string; barcode: string | null; currentQty: number; itemName: string; colorName: string | null }>;
  swatchCount: number;
  sackCount: number;
  affectedOrders: Array<{ orderNumber: string; qty: string }>;
}

// ── Çuval Depo board'u (READY=çuval depo, AT_DOOR=kapı önü) ──
// LİSTE: hafif kart (rulo içermez, cursor sayfalı). İÇERİK: karta tıklayınca
// lazy gelen tam çuval+rulo dökümü (ShipmentSackContents). Yüzlerce sevk
// birikse de board hafif kalır (FlashList + cursor + sunucu araması).
export interface SackStoreShipmentLite {
  id: string;
  shipmentNo: string;
  status: 'READY' | 'AT_DOOR';
  destination: ShipmentDestination;
  procedureCode: string | null;
  readyAt: string | null;
  customer: Ref;
  branch: { id: string; name: string } | null;
  sackCount: number;
  rollCount: number;
  totalKg: number;
  totalQty: number;
}

// Çuval içeriği — ürün+renk+en bazında grup (irsaliye-benzeri özet).
export interface SackStoreContent {
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  rollCount: number;
}
// Çuvaldaki tek tek top / kartela (barkodlu döküm).
export interface SackStoreRoll {
  id: string;
  barcode: string | null;
  qty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}
export interface SackStoreSwatch {
  id: string;
  barcode: string | null;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}
export interface SackContentSack {
  id: string;
  sackNo: string;
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  contents: SackStoreContent[];
  rolls: SackStoreRoll[];
  swatches: SackStoreSwatch[];
}
export interface ShipmentSackContents {
  id: string;
  shipmentNo: string;
  status: 'READY' | 'AT_DOOR';
  readyAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  customer: Ref;
  branch: { id: string; name: string } | null;
  sackCount: number;
  sacks: SackContentSack[];
}

// Saha #3: locate-roll cevabı — top + bulunduğu çuval/sevkiyat (ikisi de olmayabilir).
export interface LocatedRoll {
  id: string;
  barcode: string;
  status: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
  sack: { id: string; sackNo: string; seq: number; manualCode: string | null; weightKg: number | null } | null;
  shipment: {
    id: string;
    shipmentNo: string;
    status: ShipmentStatus;
    customer: { id: string; name: string };
    branch: { id: string; name: string } | null;
  } | null;
}

/** Kartela stoğu: ürün+renk bazında müsait (sevke girmemiş) kartela adedi. */
export interface KartelaStockGroup {
  itemId: string;
  itemCode: string;
  itemName: string;
  colorId: string | null;
  colorName: string | null;
  colorHex: string | null;
  count: number;
}

export const packingService = {
  // ── Sipariş seçim ──
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.branchId) q.set('branchId', params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/shipping/open-orders${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  // ── Sevkiyat oturumu ──
  createShipment: (
    orderIds: string[],
    destination?: ShipmentDestination,
  ): Promise<ApiResponse<{ id: string; shipmentNo: string; status: ShipmentStatus }>> =>
    apiClient
      .post<ApiResponse<{ id: string; shipmentNo: string; status: ShipmentStatus }>>('/shipping/shipments', {
        orderIds,
        ...(destination ? { destination } : {}),
      })
      .then((r) => r.data),

  // Saha #19: yurtiçi/yurtdışı kapsamı değiştir.
  setDestination: (id: string, destination: ShipmentDestination): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${id}/destination`, { destination })
      .then((r) => r.data),

  // Saha #21: prosedür/ihracat kodu güncelle (boş = temizle).
  setProcedureCode: (id: string, procedureCode: string | null): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${id}/procedure-code`, { procedureCode })
      .then((r) => r.data),

  getShipment: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient.get<ApiResponse<ShipmentDetail>>(`/shipping/shipments/${id}`).then((r) => r.data),

  listShipments: (params?: { status?: ShipmentStatus; customerId?: string }): Promise<ApiResponse<ShipmentListItem[]>> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<ShipmentListItem[]>>(`/shipping/shipments${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  // Sayfalı (cursor) liste — FlashList sonsuz kaydırma. Backend non-breaking cursor
  // (mode=cursor). Filtre: status + customerId (server). Geçmiş ekranı bunu kullanır.
  listShipmentsCursor: (params: {
    status?: ShipmentStatus;
    customerId?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<CursorPaginatedResponse<ShipmentListItem>> => {
    const q = new URLSearchParams();
    q.set('mode', 'cursor');
    q.set('limit', String(params.limit ?? 20));
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.status) q.set('status', params.status);
    if (params.customerId) q.set('customerId', params.customerId);
    return apiClient
      .get<CursorPaginatedResponse<ShipmentListItem>>(`/shipping/shipments?${q.toString()}`)
      .then((r) => r.data);
  },

  addOrders: (id: string, orderIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/orders`, { orderIds }).then((r) => r.data),

  removeOrder: (id: string, orderId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-order`, { orderId }).then((r) => r.data),

  // ── Okutma ──
  scan: (
    id: string,
    barcode: string,
    sackId?: string | null,
  ): Promise<
    ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; sackId?: string | null; currentQty?: number }>
  > =>
    apiClient
      .post<
        ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; sackId?: string | null; currentQty?: number }>
      >(`/shipping/shipments/${id}/scan`, { barcode, ...(sackId ? { sackId } : {}) })
      .then((r) => r.data),

  removeRoll: (id: string, rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-roll`, { rollId }).then((r) => r.data),

  removeSwatch: (id: string, swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-swatch`, { swatchId }).then((r) => r.data),

  // ── Kartela (seçerek ekle — barkod okutmadan, adet stoktan düşer) ──
  /** Kartela stoğu (ürün+renk bazında müsait adet) — seçerek-ekle picker'ını besler. */
  listKartelaStock: (search?: string): Promise<ApiResponse<KartelaStockGroup[]>> =>
    apiClient
      .get<ApiResponse<KartelaStockGroup[]>>(
        `/kartela/stock${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      )
      .then((r) => r.data),

  /** Seçerek kartela ekle: ürün+renk+adet → o gruptan N müsait kartela sevkiyata/çuvala bağlanır. */
  addKartela: (
    id: string,
    body: { itemId: string; colorId: string | null; count: number; sackId?: string | null },
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string | null }>> =>
    apiClient
      .post<ApiResponse<{ added: number; swatchIds: string[]; sackId: string | null }>>(
        `/shipping/shipments/${id}/add-kartela`,
        body,
      )
      .then((r) => r.data),

  // ── Çuval (aç / tart / içerik) ──
  // Çuval-önce: boş açılır (kg sonra weighSack ile). weightKg verilirse doğrudan tartılı açılır.
  addSack: (id: string, weightKg?: number): Promise<ApiResponse<ShipmentSackLean>> =>
    apiClient
      .post<ApiResponse<ShipmentSackLean>>(`/shipping/shipments/${id}/sacks`, weightKg != null ? { weightKg } : {})
      .then((r) => r.data),

  // Çuval kapat: brüt tartı + elle yazılan kod birlikte set edilir (kod zorunlu).
  weighSack: (sackId: string, weightKg: number, manualCode?: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/weigh`, {
        weightKg,
        ...(manualCode !== undefined ? { manualCode } : {}),
      })
      .then((r) => r.data),

  // withContents=true → KISA YOL: dolu çuvalı içeriğiyle sil; toplar/kartelalar depoya döner.
  removeSack: (sackId: string, withContents?: boolean): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/remove`, withContents ? { withContents: true } : {})
      .then((r) => r.data),

  // Topu çuvaldan çuvala taşı (aynı sevkiyat içi)
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/rolls/${rollId}/move-sack`, { sackId }).then((r) => r.data),

  // Saha #3: top yerini bul — barkod tam eşleşme (çuval + sevkiyat + statü).
  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(`/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),

  // Saha #3: iki topun çuvalını takas et (aynı sevkiyat içi; PREPARING/READY/AT_DOOR).
  swapRollSacks: (rollAId: string, rollBId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/rolls/swap-sacks`, { rollAId, rollBId }).then((r) => r.data),

  // ── Sevke Hazır / Sevk / İptal ──
  markReady: (id: string): Promise<ApiResponse<{ shipmentId: string; rollCount: number; allocatedLines: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; rollCount: number; allocatedLines: number }>>(
        `/shipping/shipments/${id}/ready`,
        {},
      )
      .then((r) => r.data),

  // Sevke hazırı geri al (READY → PREPARING) — çıkış öncesi düzenleme için.
  unready: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient.post<ApiResponse<{ shipmentId: string }>>(`/shipping/shipments/${id}/unready`, {}).then((r) => r.data),

  // Çuval Depo board'u — HAFİF + cursor sayfalı + sunucu-aramalı (FlashList).
  // Rulo ÇEKMEZ; kart sayaçları ucuz aggregate'ten. İçerik için getShipmentSackContents.
  listSackStoreBoard: (params: {
    status?: 'READY' | 'AT_DOOR';
    search?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<CursorPaginatedResponse<SackStoreShipmentLite>> => {
    const q = new URLSearchParams();
    q.set('limit', String(params.limit ?? 30));
    if (params.status) q.set('status', params.status);
    if (params.search) q.set('search', params.search);
    if (params.cursor) q.set('cursor', params.cursor);
    return apiClient
      .get<CursorPaginatedResponse<SackStoreShipmentLite>>(`/shipping/sack-store/board?${q.toString()}`)
      .then((r) => r.data);
  },

  // Tek sevkiyatın çuval+rulo dökümü (içerik modalı) — karta tıklayınca lazy.
  getShipmentSackContents: (id: string): Promise<ApiResponse<ShipmentSackContents>> =>
    apiClient
      .get<ApiResponse<ShipmentSackContents>>(`/shipping/shipments/${id}/sack-contents`)
      .then((r) => r.data),

  // Kapı Önüne Koy (PREPARING/READY → AT_DOOR) — kamyon bekleme durağı; "Alındı" ile sevk olur.
  moveToDoor: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient.post<ApiResponse<{ shipmentId: string }>>(`/shipping/shipments/${id}/move-to-door`, {}).then((r) => r.data),

  // Kapı önünden çuval depoya geri çek (AT_DOOR → READY).
  pullBackFromDoor: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient.post<ApiResponse<{ shipmentId: string }>>(`/shipping/shipments/${id}/pull-back`, {}).then((r) => r.data),

  dispatch: (
    id: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
  ): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/dispatch`, data).then((r) => r.data),

  cancelPreview: (id: string): Promise<ApiResponse<ShipmentCancelPreview>> =>
    apiClient.get<ApiResponse<ShipmentCancelPreview>>(`/shipping/shipments/${id}/cancel-preview`).then((r) => r.data),

  cancel: (id: string): Promise<ApiResponse<{ shipmentId: string; freedRolls: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; freedRolls: number }>>(`/shipping/shipments/${id}/cancel`, {})
      .then((r) => r.data),
};
