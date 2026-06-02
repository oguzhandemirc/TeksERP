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
}

export interface ShipmentDetailSack {
  id: string;
  sackNo: number | string;
  seq: number;
  weightKg: number | null;
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
