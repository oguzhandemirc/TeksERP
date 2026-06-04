import type { Tone } from "@/components/operations/StatusBadge";

export type ShipmentStatus = "PREPARING" | "READY" | "DISPATCHED" | "CANCELLED";

export const shipmentStatusLabels = {
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

export const shipmentStatusTones: Record<string, Tone> = {
  PREPARING: "warning",
  READY: "info",
  DISPATCHED: "success",
  CANCELLED: "muted",
};

/**
 * Global şube lookup öğesi (`/api/customer-branches`) — FilterBar şube filtresi.
 * `code` opsiyonel `string` (LookupItemBase ile uyum için `null` değil; backend null
 * gönderse de getLabel tolere eder). Şube adları müşteri arası tekrar edebilir →
 * `customer.name` etikette ayrım sağlar.
 */
export interface BranchLookupItem {
  id: string;
  name: string;
  code?: string;
  city?: string;
  customer: { id: string; name: string; code?: string };
}

/** Liste satırı — lean (sayılar, dizi değil). Backend listShipments select'i ile birebir. */
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
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number };
}

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
  /** Bu sevkiyatın bu satıra düşürdüğü/düşüreceği metraj (DISPATCHED'te kesin). */
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
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
  width: number | null;
  currentQty: number;
  /** İçinde bulunduğu çuval (top-level rolls'da döner; içerik/iz sürme için). */
  sackId?: string | null;
}

/** Çuval içeriğinde ürün (spec) bazlı özet — irsaliyedeki çuval dökümü. */
export interface SackProductSummary {
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  totalQty: number;
  rollCount: number;
}

export interface SackContentSwatch {
  id: string;
  barcode: string | null;
  length: number | null;
  width: number | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
}

export interface ShipmentDetailSack {
  id: string;
  sackNo: number | string;
  seq: number;
  weightKg: number | null;
  rolls: ShipmentDetailRoll[];
  swatches: SackContentSwatch[];
  productSummary: SackProductSummary[];
  rollCount: number;
  swatchCount: number;
}

export interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: { id: string; barcode: string | null; length: number | null; width: number | null }[];
  sacks: ShipmentDetailSack[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
  };
}
