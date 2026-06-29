/**
 * Çuval Düzelt / Paketleme istasyonu tipleri — backend /api/shipping sözleşmesi.
 * Mobil `packing.service.ts` ile birebir; masaüstü (tabanca-öncelikli) paketleme +
 * içerik düzeltme akışı için. Sevkiyat oturumu = tek müşteri+şube + seçilen
 * siparişler + okutulan toplar + çuval tartıları + İÇERİK (çuval-önce: topu aktif
 * çuvala okut). Karşılanma spec-toplam (top→sipariş bağı yok).
 *
 * Decimal alanlar backend'de JSON number'a çevrildiği için Number() sarma gerekmez.
 */

export type ShipmentStatus = "PREPARING" | "READY" | "AT_DOOR" | "DISPATCHED" | "CANCELLED";

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  PREPARING: "Hazırlanıyor",
  READY: "Çuval Depo",
  AT_DOOR: "Kapı Önü",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

/** İçerik değiştirilebilir durumlar (top çıkar/taşı/takas/yeniden-tartı). */
export const EDITABLE_STATUSES: ShipmentStatus[] = ["PREPARING", "READY", "AT_DOOR"];

export type ShipmentDestination = "DOMESTIC" | "EXPORT";

export const destinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
};

interface Ref {
  id: string;
  code?: string;
  name: string;
}

// ── Sipariş seçim (open-orders + depo karşılaması) ──
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

// ── Sevkiyat detayı (paketleme/düzeltme workspace'i) ──
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

/** Sevkiyatın top-level rulosu — `sackId` null ise çuvalsız (loose). */
export interface ShipmentDetailRoll {
  id: string;
  barcode: string | null;
  item: { code: string; name: string };
  color: { code: string; name: string; hex?: string | null } | null;
  width: number | null;
  currentQty: number;
  qualityGrade?: string;
  sackId?: string | null;
}

/** Çuval içindeki top (sack.rolls). */
export interface SackRoll {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  qualityGrade?: string;
  item: { code: string; name: string };
  color: { code: string; name: string; hex?: string | null } | null;
}

export interface SackSwatch {
  id: string;
  barcode: string | null;
  length?: number | null;
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
  productSummary?: SackProductSummary[];
  rollCount: number;
  swatchCount: number;
}

/** addSack lean dönüşü — yeni açılan boş çuval. */
export interface ShipmentSackLean {
  id: string;
  sackNo: string;
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
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
  swatches: Array<{
    id: string;
    barcode: string | null;
    length?: number;
    width: number | null;
    /** null ise çuvalsız (loose) — sevke hazır invariant'ı buna da bakar. */
    sackId?: string | null;
  }>;
  sacks: ShipmentSack[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
    returnedCount?: number;
    returnedMeters?: number;
  };
}

/** locate-roll cevabı — top + bulunduğu çuval/sevkiyat (ikisi de olmayabilir). */
export interface LocatedRoll {
  id: string;
  barcode: string;
  status: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
  sack: {
    id: string;
    sackNo: string;
    seq: number;
    manualCode: string | null;
    weightKg: number | null;
  } | null;
  shipment: {
    id: string;
    shipmentNo: string;
    status: ShipmentStatus;
    customer: { id: string; name: string };
    branch: { id: string; name: string } | null;
  } | null;
}

export interface CreatedShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
}

/** Scan cevabı — okutulan kod top mu kartela mı + hangi çuvala bağlandı. */
export interface ScanResult {
  kind: "ROLL" | "SWATCH";
  rollId?: string;
  swatchId?: string;
  sackId?: string | null;
  currentQty?: number;
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

export interface AddKartelaResult {
  added: number;
  swatchIds: string[];
  sackId: string | null;
}
