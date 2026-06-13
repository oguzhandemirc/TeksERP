/**
 * Çuval/Top Arama (saha #1+#23) tipleri — backend GET /api/shipping/sack-search
 * + /api/shipping/sacks/:id/contents + /api/shipping/locate-roll.
 * Decimal'lar backend'de number'a çevrilir.
 */

export type ShipmentStatusKey = "PREPARING" | "READY" | "AT_DOOR" | "DISPATCHED";

export const shipmentStatusLabels: Record<ShipmentStatusKey, string> = {
  PREPARING: "Hazırlanıyor",
  READY: "Çuval Depo",
  AT_DOOR: "Kapı Önü",
  DISPATCHED: "Sevk Edildi",
};

export interface SackSearchShipment {
  id: string;
  shipmentNo: string;
  status: ShipmentStatusKey;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
}

/** Arama sonuç satırı — bir çuval + ucuz sayaçlar (rulo satırı içermez). */
export interface SackSearchRow {
  id: string;
  sackNo: string;
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
  createdAt: string;
  shipment: SackSearchShipment;
  rollCount: number;
  totalQty: number;
  swatchCount: number;
  /** İçerik filtresi (ürün/renk/en) yokken null — sütun gizlenir. */
  matchRollCount: number | null;
  matchQty: number | null;
}

export interface SackSearchParams {
  itemId?: string;
  colorId?: string;
  width?: number;
  customerId?: string;
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
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
  shipment: SackSearchShipment;
  rolls: SackContentRoll[];
  swatches: SackContentSwatch[];
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
  sack: { id: string; sackNo: string; seq: number; manualCode: string | null } | null;
  shipment: SackSearchShipment | null;
}
