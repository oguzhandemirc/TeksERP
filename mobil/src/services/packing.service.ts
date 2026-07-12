import { apiClient } from './api';
import type { ApiResponse, CursorPaginatedResponse } from '../types/api';

// =============================================================================
// Tartı/Paket + Sevkiyat — ÇUVAL DEPO sözleşmesi (/api/shipping)
// Çuval MÜŞTERİYE ait (opsiyonel), sevkiyattan bağımsız yaşar. Akış:
//   1) Çuval aç → openSack(customerId?)                    → havuzda
//   2) Top/kartela çuvala okut → scanIntoSack(sackId)
//   3) Tart + kod → weighSack                              → çuval depoda hazır
//   4) Havuzdaki çuvallardan sevkiyat kur → createShipmentFromSacks → PLANNED
//   5) Kapı önü → moveToDoor (AT_DOOR); sevk → dispatch (DISPATCHED)
// Karşılanma spec-toplam (SackAllocation defteri) — top→sipariş bağı YOK.
// =============================================================================

// PLANNED (planlı) | AT_DOOR (kapı önü) | DISPATCHED (sevk edildi) | CANCELLED (iptal)
export type ShipmentStatus = 'PLANNED' | 'AT_DOOR' | 'DISPATCHED' | 'CANCELLED';
/** Saha #19+#22: yurtiçi/yurtdışı sevkiyat kapsamı. */
export type ShipmentDestination = 'DOMESTIC' | 'EXPORT';
export const shipmentDestinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: 'Yurtiçi',
  EXPORT: 'Yurtdışı',
};

export const SHIPMENT_STATUS_TR: Record<ShipmentStatus, string> = {
  PLANNED: 'Planlı',
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
  };
  lines: OpenOrderLine[];
}

// ── Çuval Havuzu — müşteri-gruplu board (Tartı/Paket giriş ekranı "Sürdür") ──
// Müşterisiz (havuzda müşteri atanmamış) çuvallar için customer null olabilir.
export interface PoolCustomerGroup {
  customer: { id: string; code: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalMeters: number;
  rollCount: number;
}

// ── Müşterinin havuz çuvalları (Paketleme workspace canlı kaynağı) ──
export interface PoolSackRoll {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  item: { code: string; name: string };
  color: { code: string; name: string; hex: string | null } | null;
}
export interface PoolSackSwatch {
  id: string;
  barcode: string | null;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
}
export interface PoolSack {
  id: string;
  sackNo: string;
  manualCode: string | null;
  weightKg: number | null;
  branch: { id: string; name: string } | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  rolls: PoolSackRoll[];
  swatches: PoolSackSwatch[];
}
export interface CustomerPoolSacks {
  customer: { id: string; code: string; name: string };
  sacks: PoolSack[];
}

/** openSack dönüşü — yeni açılan (boş) havuz çuvalı. Müşteri opsiyonel. */
export interface OpenedSack {
  id: string;
  sackNo: string;
  manualCode: string | null;
  weightKg: number | null;
  customerId: string | null;
  branchId: string | null;
}

/** scanIntoSack dönüşü. */
export interface ScanResult {
  kind: 'ROLL' | 'SWATCH';
  rollId?: string;
  swatchId?: string;
  sackId: string;
  currentQty?: number;
}

/** createShipmentFromSacks dönüşü. */
export interface CreatedShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  destination: ShipmentDestination;
}

/** previewCreateShipment — karşılanan sipariş satırı (spec-toplam defterinden). */
export interface ShipmentPreviewLine {
  lineId: string;
  orderNumber: string;
  item: string;
  color: string | null;
  width: number | null;
  need: number;
  allocated: number;
}
/** previewCreateShipment dönüşü — salt-okunur kurulum önizlemesi. */
export interface ShipmentPreview {
  sacks: unknown[];
  lines: ShipmentPreviewLine[];
  warnings: string[];
  totals: { totalMeters: number; sackCount: number; surplusMeters: number };
}

// ── Sevkiyat detayı ──
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
  /** İçinde bulunduğu çuval. */
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
  seq: number | null;
  /** Operatörün çuval üstüne yazdığı kod. */
  manualCode: string | null;
  weightKg: number | null;
  rolls: SackRoll[];
  swatches: SackSwatch[];
  productSummary: SackProductSummary[];
  rollCount: number;
  swatchCount: number;
}
/** Bu sevkiyattan iade edilmiş top (RollReturn'den). */
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
  dispatchedAt: string | null;
  customer: Ref;
  branch: { id: string; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: { id: string; barcode: string | null; length: number; width: number | null }[];
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
  sackCount: number;
  rollCount: number;
  swatchCount: number;
  affectedOrders: { orderNumber: string; qty: string }[];
}

// ── Sevk kapısı board'u (PLANNED=planlı, AT_DOOR=kapı önü) ──
// LİSTE: hafif kart (rulo içermez, cursor sayfalı). İÇERİK: karta tıklayınca
// lazy gelen tam çuval+rulo dökümü (ShipmentSackContents).
export interface SackStoreShipmentLite {
  id: string;
  shipmentNo: string;
  status: 'PLANNED' | 'AT_DOOR';
  destination: ShipmentDestination;
  procedureCode: string | null;
  createdAt: string;
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
  seq: number | null;
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
  status: 'PLANNED' | 'AT_DOOR';
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
  sack: { id: string; sackNo: string; seq: number | null; manualCode: string | null; weightKg: number | null } | null;
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
  // ── Sipariş seçim (rehber) ──
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.branchId) q.set('branchId', params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/shipping/open-orders${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  // =========================================================================
  // ÇUVAL DEPO — çuval aç / okut / tart (sevkiyattan bağımsız)
  // =========================================================================

  /** Yeni (boş) havuz çuvalı aç. Müşteri opsiyonel (müşterisiz havuz da olur). */
  openSack: (body: {
    customerId?: string | null;
    branchId?: string | null;
    weightKg?: number | null;
    manualCode?: string | null;
  }): Promise<ApiResponse<OpenedSack>> =>
    apiClient.post<ApiResponse<OpenedSack>>('/shipping/sacks', body).then((r) => r.data),

  /** Barkod okut → top/kartelayı AÇIK havuz çuvalına ekle (veya aynı müşterinin açık çuvalları arası taşı). */
  scanIntoSack: (sackId: string, barcode: string): Promise<ApiResponse<ScanResult>> =>
    apiClient.post<ApiResponse<ScanResult>>(`/shipping/sacks/${sackId}/scan`, { barcode }).then((r) => r.data),

  /** Seçerek kartela ekle (barkodsuz) — ürün+renk+adet → açık çuvala N müsait kartela. */
  addKartelaToSack: (
    sackId: string,
    body: { itemId: string; colorId: string | null; count: number },
  ): Promise<ApiResponse<{ added: number; swatchIds: string[]; sackId: string }>> =>
    apiClient
      .post<ApiResponse<{ added: number; swatchIds: string[]; sackId: string }>>(
        `/shipping/sacks/${sackId}/add-kartela`,
        body,
      )
      .then((r) => r.data),

  /** Çuval brüt tartı ve/veya kodunu güncelle (havuz çuvalı). */
  weighSack: (sackId: string, body: { weightKg?: number; manualCode?: string }): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/weigh`, body).then((r) => r.data),

  /** Havuz çuvalını sil. withContents=true → dolu çuval içeriğiyle silinir (toplar depoya döner). */
  removeSack: (sackId: string, withContents?: boolean): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/remove`, withContents ? { withContents: true } : {})
      .then((r) => r.data),

  /** Topu açık çuvaldan çıkar → serbest depoya döner. */
  removeRollFromSack: (rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/rolls/${rollId}/remove-from-sack`, {}).then((r) => r.data),

  /** Kartelayı açık çuvaldan çıkar. */
  removeSwatchFromSack: (swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/swatches/${swatchId}/remove-from-sack`, {}).then((r) => r.data),

  /** Topu bir açık çuvaldan diğerine taşı (aynı müşteri). */
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/rolls/${rollId}/move-sack`, { sackId }).then((r) => r.data),

  /** Çuval depo havuzu board'u — müşteri-gruplu özet. */
  listPool: (params?: { customerId?: string; search?: string }): Promise<ApiResponse<PoolCustomerGroup[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return apiClient.get<ApiResponse<PoolCustomerGroup[]>>(`/shipping/pool${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  /** Bir müşterinin havuz çuvalları — içerikleriyle. Paketleme workspace kaynağı. */
  listCustomerPoolSacks: (customerId: string): Promise<ApiResponse<CustomerPoolSacks>> =>
    apiClient
      .get<ApiResponse<CustomerPoolSacks>>(`/shipping/pool/sacks?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.data),

  // ── Kartela stoğu (seçerek-ekle picker'ını besler) ──
  listKartelaStock: (search?: string): Promise<ApiResponse<KartelaStockGroup[]>> =>
    apiClient
      .get<ApiResponse<KartelaStockGroup[]>>(
        `/kartela/stock${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      )
      .then((r) => r.data),

  // =========================================================================
  // SEVKİYAT — havuzdan çuval seçerek kur + yaşam döngüsü
  // =========================================================================

  /** Havuzdaki çuvallardan yeni sevkiyat kur (PLANNED). Müşteri zorunlu. */
  createShipmentFromSacks: (body: {
    sackIds: string[];
    customerId: string;
    branchId?: string | null;
    orderIds?: string[];
    destination?: ShipmentDestination;
    procedureCode?: string | null;
  }): Promise<ApiResponse<CreatedShipment>> =>
    apiClient.post<ApiResponse<CreatedShipment>>('/shipping/shipments', body).then((r) => r.data),

  /** Sevkiyat kurulum önizlemesi (salt-okunur) — karşılanan sipariş satırları + fazlalık. */
  previewCreateShipment: (body: {
    sackIds: string[];
    customerId?: string | null;
    branchId?: string | null;
    orderIds?: string[];
  }): Promise<ApiResponse<ShipmentPreview>> =>
    apiClient
      .post<ApiResponse<ShipmentPreview>>('/shipping/shipments/preview', body)
      .then((r) => r.data),

  /** PLANNED sevkiyata havuzdan çuval ekle. */
  addSacksToShipment: (id: string, sackIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/add-sacks`, { sackIds }).then((r) => r.data),

  /** PLANNED sevkiyattan çuval çıkar → havuza döner (mühürlü kalır). */
  removeSackFromShipment: (id: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-sack`, { sackId }).then((r) => r.data),

  // Saha #19: yurtiçi/yurtdışı kapsamı değiştir (PLANNED).
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

  // Sayfalı (cursor) liste — FlashList sonsuz kaydırma. Geçmiş ekranı bunu kullanır.
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

  // Sevk Kapısı board'u — HAFİF + cursor sayfalı + sunucu-aramalı (FlashList).
  // status: PLANNED (planlı) | AT_DOOR (kapı önü); ikisi de → boş bırak.
  listSackStoreBoard: (params: {
    status?: 'PLANNED' | 'AT_DOOR';
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

  // Kapı Önüne Koy (PLANNED → AT_DOOR) — kamyon bekleme durağı; "Alındı" ile sevk olur.
  moveToDoor: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient.post<ApiResponse<{ shipmentId: string }>>(`/shipping/shipments/${id}/move-to-door`, {}).then((r) => r.data),

  // Kapı önünden geri çek (AT_DOOR → PLANNED).
  pullBackFromDoor: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient.post<ApiResponse<{ shipmentId: string }>>(`/shipping/shipments/${id}/pull-back`, {}).then((r) => r.data),

  dispatch: (
    id: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
  ): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/dispatch`, data).then((r) => r.data),

  cancelPreview: (id: string): Promise<ApiResponse<ShipmentCancelPreview>> =>
    apiClient.get<ApiResponse<ShipmentCancelPreview>>(`/shipping/shipments/${id}/cancel-preview`).then((r) => r.data),

  cancel: (id: string): Promise<ApiResponse<{ shipmentId: string; freedSacks: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; freedSacks: number }>>(`/shipping/shipments/${id}/cancel`, {})
      .then((r) => r.data),

  // Saha #3: top yerini bul — barkod tam eşleşme (çuval + sevkiyat + statü).
  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(`/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),
};
