/**
 * Paketleme (Çuval Havuzu modeli) tipleri — backend /api/shipping.
 * Çuval MÜŞTERİYE aittir; paketleme müşteri-bazlıdır: çuval aç → top okut → mühürle →
 * çuval depo havuzuna girer. Sevkiyat AYRI kurulur (Çuval & Top Arama'dan seçilerek).
 * Decimal alanlar backend'de JSON number'a çevrilir.
 */

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

// ── Sipariş seçim / rehber (open-orders + depo karşılaması) ──
export interface OpenOrderLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  packed: number;
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

// ── Havuz çuvalı (müşteri paketleme workspace'i) ──
export interface PoolSackRoll {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  item: { code: string; name: string };
  color: { code: string; name: string; hex?: string | null } | null;
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
  /** true = mühürlü (havuzda); false = açık (paketleniyor). */
  sealed: boolean;
  branch: { id: string; name: string } | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  rolls: PoolSackRoll[];
  swatches: PoolSackSwatch[];
}

export interface CustomerPool {
  customer: Ref;
  sacks: PoolSack[];
}

/** openSack lean dönüşü. */
export interface OpenedSack {
  id: string;
  sackNo: string;
  manualCode: string | null;
  weightKg: number | null;
  customerId: string;
  branchId: string | null;
}

/** Scan cevabı — okutulan kod top mu kartela mı + hangi çuvala bağlandı. */
export interface ScanResult {
  kind: "ROLL" | "SWATCH";
  rollId?: string;
  swatchId?: string;
  sackId?: string | null;
  currentQty?: number;
}

/** Kartela stoğu: ürün+renk bazında müsait (çuvala/sevke girmemiş) kartela adedi. */
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
  sackId: string;
}

/** locate-roll cevabı — top + bulunduğu çuval/sevkiyat. */
export interface LocatedRoll {
  id: string;
  barcode: string;
  status: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
  sack: { id: string; sackNo: string; manualCode: string | null; weightKg: number | null } | null;
  shipment: { id: string; shipmentNo: string; status: string } | null;
}
