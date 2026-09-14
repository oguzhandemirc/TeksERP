// =============================================================================
// FASON DOKUMA (G2p) — panel tipleri: backend `/api/subcontractor-weaving` DTO'ları
// =============================================================================
export interface FasonBeamEvent {
  kind: string;
  lengthM: number | null;
}

export interface FasonDispatch {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  cancelledAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  items: { warpBeam: { id: string; beamNo: string; status: string } | null; events: FasonBeamEvent[] }[];
}

export interface FasonBornRoll {
  id: string;
  barcode: string | null;
  status: string;
  initialQty: number;
}

export interface FasonReceipt {
  id: string;
  receiptNo: string;
  receivedAt: string;
  cancelledAt: string | null;
  manifestNo: string | null;
  bornRolls: FasonBornRoll[];
}

export interface FasonTotals {
  sentM: number;
  returnedM: number;
  bornM: number;
  differenceM: number;
}

export interface FasonSummary {
  weavingOrder: {
    id: string;
    weavingOrderNumber: string;
    executionKind: string;
    subcontractorId: string | null;
    status: string;
  };
  dispatches: FasonDispatch[];
  receipts: FasonReceipt[];
  totals: FasonTotals;
}

export interface FasonReceiptRow {
  initialQty: string;
  width: string;
  weightKg: string;
  qualityGrade: string;
  /** Boş = işin rengi (sunucu `colorId ?? weavingOrder.colorId`). */
  colorId: string | null;
}

export interface FasonReceiptResult {
  receipt: { id: string; receiptNo: string };
  rolls: { id: string; barcode: string | null; initialQty: number }[];
  failed: { index: number; message: string }[];
}

export interface FasonCancelPreview {
  receiptNo: string;
  cancelledAt: string | null;
  bornRolls: (FasonBornRoll & { blocks: boolean })[];
  canCancel: boolean;
  aliveCount: number;
}
