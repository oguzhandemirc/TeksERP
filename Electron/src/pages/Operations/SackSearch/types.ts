/**
 * Çuval/Top Arama + HAVUZDAN SEVKİYAT KURMA tipleri — backend /api/shipping/sack-search
 * + /sacks/:id/contents + /locate-roll + POST /shipments (sackIds) + /shipments/preview.
 * ÇUVAL HAVUZU MODELİ: çuval müşteriye ait; shipment null = havuzda (mühürlü/açık).
 * Decimal'lar backend'de number'a çevrilir.
 */

export type ShipmentStatusKey = "PLANNED" | "AT_DOOR" | "DISPATCHED";

export const shipmentStatusLabels: Record<ShipmentStatusKey, string> = {
  PLANNED: "Planlı Sevkiyat",
  AT_DOOR: "Kapı Önü",
  DISPATCHED: "Sevk Edildi",
};

/** Arama kapsamı — havuz / planlı+kapı / sevk edilmiş / tümü. */
export type SackSearchScope = "POOL" | "PLANNED" | "DISPATCHED" | "ALL";

export const scopeLabels: Record<SackSearchScope, string> = {
  POOL: "Havuz (sevk edilmemiş)",
  PLANNED: "Planlı / Kapı Önü",
  DISPATCHED: "Sevk Edilmiş",
  ALL: "Tümü",
};

/** Çuvalın görünen durumu — arama kartında rozet (havuz/açık/planlı/sevk). */
export type SackDisplayState = "OPEN" | "POOL" | "PLANNED" | "AT_DOOR" | "DISPATCHED";

export const sackStateLabels: Record<SackDisplayState, string> = {
  OPEN: "Açık (paketleniyor)",
  POOL: "Havuzda (mühürlü)",
  PLANNED: "Planlı Sevkiyat",
  AT_DOOR: "Kapı Önü",
  DISPATCHED: "Sevk Edildi",
};

export interface SackSearchShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
}

export interface SackCustomerRef {
  id: string;
  name: string;
}

/** Arama sonuç satırı — bir çuval + ucuz sayaçlar (rulo satırı içermez). */
export interface SackSearchRow {
  id: string;
  sackNo: string;
  seq: number | null;
  manualCode: string | null;
  weightKg: number | null;
  sealedAt: string | null;
  createdAt: string;
  customer: SackCustomerRef | null;
  branch: { id: string; name: string } | null;
  /** null = havuzda (mühürlü/açık); dolu = sevkiyata atanmış. */
  shipment: SackSearchShipment | null;
  rollCount: number;
  totalQty: number;
  swatchCount: number;
  /** İçerik filtresi (ürün/renk/en) yokken null — sütun gizlenir. */
  matchRollCount: number | null;
  matchQty: number | null;
}

/** Bir çuvalın görünen durumunu hesapla. */
export function sackDisplayState(sack: Pick<SackSearchRow, "shipment" | "sealedAt">): SackDisplayState {
  if (sack.shipment) {
    if (sack.shipment.status === "DISPATCHED") return "DISPATCHED";
    if (sack.shipment.status === "AT_DOOR") return "AT_DOOR";
    return "PLANNED";
  }
  return sack.sealedAt ? "POOL" : "OPEN";
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

export interface SackContentRoll {
  id: string;
  barcode: string;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackContentSwatch {
  id: string;
  barcode: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackContents {
  id: string;
  sackNo: string;
  seq: number | null;
  manualCode: string | null;
  weightKg: number | null;
  customer?: SackCustomerRef | null;
  shipment: SackSearchShipment | null;
  rolls: SackContentRoll[];
  swatches: SackContentSwatch[];
}

/** Çeki listesi satırı — POST /api/shipping/sack-search/pick-list cevabı. */
export interface PickListRow {
  id: string;
  sackNo: string;
  seq: number | null;
  manualCode: string | null;
  weightKg: number | null;
  customer?: SackCustomerRef | null;
  shipment: SackSearchShipment | null;
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

export interface LocatedRollShipment extends SackSearchShipment {
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
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
  sack: { id: string; sackNo: string; seq: number | null; manualCode: string | null; weightKg: number | null } | null;
  shipment: LocatedRollShipment | null;
}

export type ShipmentDestination = "DOMESTIC" | "EXPORT";

/** Sevkiyat kurulum önizlemesi — POST /shipments/preview. */
export interface CreateShipmentPreview {
  sacks: { id: string; sackNo: string; manualCode: string | null; weightKg: number | null; rollCount: number; totalMeters: number }[];
  orders: { orderNumber: string; qty: number }[];
  totals: { totalMeters: number; sackCount: number };
}

export interface CreatedShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
  destination: ShipmentDestination;
}
