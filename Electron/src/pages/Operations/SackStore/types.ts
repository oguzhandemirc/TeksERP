/**
 * Çuval Depo (Sack Warehouse) tipleri — backend GET /api/shipping/sack-store
 * yanıtıyla birebir. READY = "Çuval Depo" (firma içinde bekleyen), AT_DOOR =
 * "Kapı Önü" (sevke hazır, kapıda). Decimal alanlar backend'de JSON number'a
 * çevrildiği için Number() sarmaya gerek yok.
 */

export type SackStoreStatus = "READY" | "AT_DOOR";

export const sackStoreStatusLabels: Record<SackStoreStatus, string> = {
  READY: "Çuval Depo",
  AT_DOOR: "Kapı Önü",
};

/** Çuval içindeki bir ürün (spec) satırı — kumaş + renk + en + metraj. */
export interface SackContent {
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  rollCount: number;
}

export interface SackStoreSack {
  id: string;
  sackNo: string;
  seq: number;
  /** Operatörün çuvala yazdığı serbest kod. */
  manualCode: string | null;
  weightKg: number | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  contents: SackContent[];
}

export interface SackStoreShipment {
  id: string;
  shipmentNo: string;
  status: SackStoreStatus;
  readyAt: string | null;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalQty: number;
  sacks: SackStoreSack[];
}

/** Sevk çıkışı (dispatch) opsiyonel taşıma bilgileri — hepsi nullable. */
export interface DispatchPayload {
  plateNumber?: string | null;
  driverName?: string | null;
  carrier?: string | null;
}
