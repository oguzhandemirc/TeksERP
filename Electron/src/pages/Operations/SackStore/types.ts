/**
 * Sevk Kapısı (Sack Store board) tipleri — backend GET /api/shipping/sack-store
 * (HAFİF, sayfalı liste) + /api/shipping/shipments/:id/sack-contents (slide-over).
 * Board YALNIZ PLANNED (çıkış bekleyen) sevkleri döner; bu ekran ancak sevk onayı
 * ("shipping.confirmationEnabled") AÇIKKEN dolar (kapalıyken sevkler doğrudan çıkar).
 * Decimal alanlar backend'de JSON number'a çevrildiği için Number() sarmaya gerek yok.
 */

export type SackStoreStatus = "PLANNED";

export const sackStoreStatusLabels: Record<SackStoreStatus, string> = {
  PLANNED: "Planlı Sevkiyat",
};

// ===========================================================================
// LİSTE (board kartı) — rulo İÇERMEZ, yalnız ucuz sayaçlar
// ===========================================================================
export type ShipmentDestination = "DOMESTIC" | "EXPORT";

export const destinationLabels: Record<ShipmentDestination, string> = {
  DOMESTIC: "Yurtiçi",
  EXPORT: "Yurtdışı",
};

export interface SackStoreShipment {
  id: string;
  shipmentNo: string;
  status: SackStoreStatus;
  destination: ShipmentDestination;
  procedureCode: string | null;
  createdAt: string;
  customer: { id: string; code?: string; name: string };
  branch: { id: string; code?: string | null; name: string } | null;
  sackCount: number;
  rollCount: number;
  totalKg: number;
  totalQty: number;
}

/** GET /sack-store query parametreleri (sunucu arama + cursor sayfalama). */
export interface SackStoreListParams {
  /** Board yalnız PLANNED döner; filtre pratikte tek değerli. */
  status?: SackStoreStatus;
  search?: string;
  /** Saha #22: yurtiçi/yurtdışı filtresi. */
  destination?: ShipmentDestination;
  cursor?: string | null;
  limit?: number;
}

export interface SackStoreListResponse {
  success: boolean;
  data: SackStoreShipment[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

// ===========================================================================
// SLIDE-OVER (karta tıklayınca) — çuval + içindeki toplar (lazy)
// ===========================================================================

/** Çuval içeriği — ürün+renk+en bazında grup (irsaliye-benzeri özet döküm). */
export interface SackContent {
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  rollCount: number;
}

/** Çuvaldaki tek tek top (barkodlu döküm). */
export interface SackRoll {
  id: string;
  barcode: string | null;
  qty: number;
  width: number | null;
  qualityGrade: string;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface SackSwatch {
  id: string;
  barcode: string | null;
  item: { id: string; name: string };
  color: { id: string; name: string; hex: string | null } | null;
}

export interface ContentSack {
  id: string;
  sackNo: string;
  seq: number;
  weightKg: number | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  contents: SackContent[];
  rolls: SackRoll[];
  swatches: SackSwatch[];
}

export interface ShipmentContents {
  id: string;
  shipmentNo: string;
  status: SackStoreStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  sacks: ContentSack[];
}

/** Sevk çıkışı (dispatch) opsiyonel taşıma bilgileri — hepsi nullable. */
export interface DispatchPayload {
  plateNumber?: string | null;
  driverName?: string | null;
  carrier?: string | null;
}
