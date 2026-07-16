import type { Tone } from "@/components/operations/StatusBadge";

export type ShipmentStatus = "PLANNED" | "DISPATCHED" | "CANCELLED";

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  PLANNED: "Planlı",
  DISPATCHED: "Sevk Edildi",
  CANCELLED: "İptal",
};

// Tone paleti semantiktir (StatusBadge): indigo/kırmızı literal Tone'da yok → en
// yakın anlamsal eşleme — PLANNED=info (indigo/mavi), DISPATCHED=muted,
// CANCELLED=danger (kırmızı).
export const shipmentStatusTones: Record<ShipmentStatus, Tone> = {
  PLANNED: "info",
  DISPATCHED: "muted",
  CANCELLED: "danger",
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
  /** SHIPMENT = çuval sevkiyatı; DIRECT = fasondan doğrudan sevk (DirectShipment).
   *  Birleşik liste iki tabloyu tek akışta döner. */
  kind: "SHIPMENT" | "DIRECT";
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  /** Yalnız DIRECT satırlarında dolu — doğrudan sevk sebebi. */
  reason?: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number; returns: number };
}

/** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik listeden DIRECT satırı açılınca. */
export interface DirectShipmentDetail {
  id: string;
  kind: "DIRECT";
  shipmentNo: string;
  reason: string;
  totalQty: number;
  rollCount: number;
  shippedAt: string;
  createdAt: string;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  shippedBy: string | null;
  dispatch: {
    id: string;
    dispatchNo: string;
    subcontractor: { id: string; name: string; code: string | null };
    workOrder: { id: string; workOrderNumber: string };
    stationName: string;
    stepSequence: number;
  };
  rolls: {
    id: string;
    barcode: string | null;
    itemName: string;
    colorName: string | null;
    currentQty: number;
    width: number | null;
    qualityGrade: string | null;
  }[];
  allocations: {
    orderNumber: string;
    itemName: string;
    colorName: string | null;
    qty: number;
  }[];
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
  /** requested − shipped. */
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

/** Bu sevkiyattan iade edilmiş top (canlı rolls'ta görünmez; RollReturn'den gelir). */
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
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: { id: string; barcode: string | null; length: number | null; width: number | null }[];
  sacks: ShipmentDetailSack[];
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
