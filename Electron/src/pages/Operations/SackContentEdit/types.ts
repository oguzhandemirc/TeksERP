// Çuval Deposu / Paketleme hub tipleri — backend /api/shipping (Çuval Depo modeli).
// Mühür/seal + packedQty KALDIRILDI. `shipment === null` → çuval DEPODA (düzenlenebilir);
// doluysa sevkiyatta. Decimal'lar JSON number/string döner → kullanırken Number() sar.

// ── Sevkiyat statüleri / kapsam ──────────────────────────────────────────────
export type ShipmentStatusKey = "PLANNED" | "DISPATCHED";

export const shipmentStatusLabels: Record<ShipmentStatusKey, string> = {
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edildi",
};

/** Arama kapsamı — depo / planlı / sevk edilmiş / tümü. */
export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export const scopeLabels: Record<SackSearchScope, string> = {
  POOL: "Depoda (sevk edilmemiş)",
  PLANNED: "Planlı Sevkiyat",
  DISPATCHED: "Sevk Edilmiş",
  ALL: "Tümü",
};

export type ShipmentDestination = "DOMESTIC" | "EXPORT";

export const destinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
};

// ── Ortak referanslar ────────────────────────────────────────────────────────
export interface SackCustomerRef {
  id: string;
  name: string;
}

export interface SackShipmentRef {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
}

/** Depodaki çuval mı — çoklu seçim/sevkiyat/düzenleme yalnız bunlarda açık. */
export function isWarehouseSack(s: { shipment: SackShipmentRef | null }): boolean {
  return s.shipment === null;
}

// ── Arama sonuç satırı (GET /sack-search, cursor) ────────────────────────────
export interface SackSearchRow {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  createdAt: string;
  customer: SackCustomerRef | null;
  branch: { id: string; code: string | null; name: string } | null;
  /** null = depoda (düzenlenebilir); dolu = bir sevkiyata atanmış. */
  shipment: SackShipmentRef | null;
  rollCount: number;
  totalQty: number;
  swatchCount: number;
  /** İçerik filtresi (kumaş/renk/en) yokken null — eşleşme sütunu gizlenir. */
  matchRollCount: number | null;
  matchQty: number | null;
}

export interface SackSearchParams {
  itemId?: string;
  colorId?: string;
  width?: number;
  customerId?: string;
  scope?: SackSearchScope;
  shipmentNo?: string;
  sackCode?: string;
  includeDispatched?: boolean;
  cursor?: string | null;
  limit?: number;
}

export interface SackSearchResponse {
  success: boolean;
  data: SackSearchRow[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
}

// ── Tek çuval dökümü (GET /sacks/:id/contents) — editör + arama detayı ───────
export interface SackContentRoll {
  id: string;
  barcode: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackContentSwatch {
  id: string;
  barcode: string | null;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackContents {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  /** Dolu = sevkiyatta (içerik kilitli); null = depoda. */
  shipment:
    | (SackShipmentRef & {
        customer?: SackCustomerRef | null;
        branch?: { id: string; code: string | null; name: string } | null;
      })
    | null;
  rolls: SackContentRoll[];
  swatches: SackContentSwatch[];
}

// ── Müşteri havuzu (GET /pool/sacks) — taşıma hedefleri için ──────────────────
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
  weightKg: number | null;
  branch: { id: string; code: string | null; name: string } | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  rolls: PoolSackRoll[];
  swatches: PoolSackSwatch[];
}

export interface CustomerPool {
  customer: { id: string; code?: string; name: string };
  sacks: PoolSack[];
}

/** POST /sacks lean dönüşü. Müşteri artık opsiyonel → nullable. Ad/kod çözülmüş döner
 *  (istemci editör hedefini fetch'siz kurar). */
export interface OpenedSack {
  id: string;
  sackNo: string;
  weightKg: number | null;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
}

/** Scan cevabı — okutulan kod top mu kartela mı + hangi çuvala bağlandı. */
export interface ScanResult {
  kind: "ROLL" | "SWATCH";
  rollId?: string;
  swatchId?: string;
  sackId?: string | null;
  currentQty?: number;
}

/** Kartela stoğu: kumaş+renk bazında müsait (çuvala/sevke girmemiş) adet. */
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

// ── Sipariş seçim / rehber (GET /open-orders) — packed KALDIRILDI ────────────
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
    customer: { id: string; code?: string; name: string };
    branch: { id: string; code: string | null; name: string } | null;
  };
  lines: OpenOrderLine[];
}

// ── Top yerini bul (GET /locate-roll) ────────────────────────────────────────
export interface LocatedRollShipment extends SackShipmentRef {
  customer: { id: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
}

export interface LocatedRoll {
  id: string;
  barcode: string;
  status: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
  sack: { id: string; sackNo: string; seq: number | null; weightKg: number | null } | null;
  shipment: LocatedRollShipment | null;
}

// ── Çeki listesi (POST /sack-search/pick-list) ───────────────────────────────
export interface PickListRow {
  id: string;
  sackNo: string;
  seq: number | null;
  weightKg: number | null;
  customer?: SackCustomerRef | null;
  branch?: { id: string; code: string | null; name: string } | null;
  shipment: SackShipmentRef | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  contents: {
    itemName: string;
    colorName: string | null;
    width: number | null;
    qty: number;
    rollCount: number;
  }[];
}

// ── Sevkiyat kurulum önizlemesi + sonuç ──────────────────────────────────────
export interface PreviewSack {
  id: string;
  sackNo: string;
  weightKg: number | null;
  rollCount: number;
  totalMeters: number;
}

export interface PreviewLine {
  lineId: string;
  orderNumber: string;
  item: string;
  color: string | null;
  width: number | null;
  need: number;
  allocated: number;
}

export interface CreateShipmentPreview {
  sacks: PreviewSack[];
  lines: PreviewLine[];
  /** Fazla mal / mükerrer / siparişsiz uyarıları — DİKKAT çekilecek. */
  warnings: string[];
  totals: { totalMeters: number; sackCount: number; surplusMeters: number };
}

export interface CreatedShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
  /**
   * Sevk onayı KAPALIYKEN (varsayılan) true → çuvallar oluşturulur oluşturulmaz
   * SEVK EDİLDİ (status=DISPATCHED, stok düştü). AÇIKKEN false → yalnız PLANNED
   * kuruldu, çıkış Sevk Kapısı'ndan ayrıca onaylanır.
   */
  dispatched: boolean;
}

// ── Editör hedefi (liste → editör geçişi) ────────────────────────────────────
export interface EditorTarget {
  sackId: string;
  sackNo: string;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  /** true = "Yeni Çuval" ile az önce açıldı (boş başlar). */
  isNew?: boolean;
}
