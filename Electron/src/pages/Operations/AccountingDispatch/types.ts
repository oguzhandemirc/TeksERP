/**
 * Saha #2 — Muhasebe / Sevk Edilenler ekranı tipleri.
 * Liste: GET /api/shipping/shipments (status=DISPATCHED, salt-okunur).
 * Fiş: GET /api/shipping/shipments/:id/dispatch-report (3 bölümlü ornek-fis).
 */

export interface DispatchListItem {
  id: string;
  shipmentNo: string;
  status: string;
  dispatchedAt: string | null;
  createdAt: string;
  customer: { id: string; code?: string; name: string };
  branch: { id: string; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number; returns: number };
}

export interface DispatchReport {
  header: {
    shipmentNo: string;
    customerName: string;
    customerCode: string;
    branchName: string | null;
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
