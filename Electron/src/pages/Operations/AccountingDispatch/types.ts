/**
 * Saha #2 — Muhasebe / Sevk Edilenler ekranı tipleri.
 * Liste: GET /api/shipping/shipments (status=DISPATCHED, salt-okunur).
 * Fiş: GET /api/shipping/shipments/:id/dispatch-report (3 bölümlü ornek-fis).
 */

export interface DispatchListItem {
  id: string;
  /** SHIPMENT = çuval sevkiyatı; DIRECT = fasondan doğrudan sevk (DirectShipment).
   *  Birleşik liste iki tabloyu tek akışta döner (listShipments). Fiş/Excel akışları
   *  bu ayrıma göre farklı uca gider. */
  kind: "SHIPMENT" | "DIRECT";
  shipmentNo: string;
  status: string;
  dispatchedAt: string | null;
  createdAt: string;
  customer: { id: string; code?: string; name: string };
  branch: { id: string; code: string | null; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number; returns: number };
}

export interface DispatchReport {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string;
    branchName: string | null;
    /** Müşteri şube kodu (ihracat) — belgede toggle'lı. */
    branchCode: string | null;
    procedureCode: string | null;
    destination: "DOMESTIC" | "EXPORT";
    status: string;
    date: string;
  };
  products: Array<{ name: string; rollCount: number; totalMeters: number }>;
  sacks: Array<{ code: string; seq: number; totalMeters: number; totalKg: number; packageCount: number }>;
  cekiRows: Array<{
    rollId: string;
    sackCode: string;
    barcode: string | null;
    desen: string;
    varyant: string;
    meters: number;
    kg: number;
  }>;
  totals: { totalRolls: number; totalMeters: number; totalKg: number; sackCount: number };
}

/**
 * Muhasebe Excel dökümü veri seti — GET /api/shipping/accounting-export.
 * Miktar-odaklı (fiyat YOK). Tarihler ISO string; sayılar düz number.
 */
export interface AccountingExportData {
  range: {
    from: string | null;
    to: string | null;
    field: string | null;
    /** "period" (tarih aralığı) | "selection" (işaretli sevkler). */
    mode?: "period" | "selection";
    selectedCount?: number;
  };
  shipments: Array<{
    shipmentNo: string;
    dispatchedAt: string;
    customerCode: string;
    customerName: string;
    taxNumber: string;
    branchName: string;
    branchCode: string;
    destination: "DOMESTIC" | "EXPORT";
    procedureCode: string;
    plateNumber: string;
    driverName: string;
    carrier: string;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
  }>;
  detail: Array<{
    shipmentNo: string;
    dispatchedAt: string;
    customerName: string;
    orderNos: string;
    itemName: string;
    colorName: string;
    width: number | null;
    rollCount: number;
    meters: number;
  }>;
  byCustomer: Array<{
    customerCode: string;
    customerName: string;
    taxNumber: string;
    shipmentCount: number;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
  }>;
  byProduct: Array<{
    itemName: string;
    colorName: string;
    width: number | null;
    rollCount: number;
    totalMeters: number;
  }>;
  returns: Array<{
    returnedAt: string;
    customerName: string;
    fromShipmentNo: string;
    barcode: string;
    itemName: string;
    colorName: string;
    width: number | null;
    meters: number;
    reason: string;
  }>;
  totals: {
    shipmentCount: number;
    sackCount: number;
    rollCount: number;
    totalMeters: number;
    totalKg: number;
    returnMeters: number;
  };
}
