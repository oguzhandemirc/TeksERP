// =============================================================================
// FASON DOKUMA (G2p) — panel tipleri: backend `/api/subcontractor-weaving` DTO'ları
// =============================================================================
export interface FasonBeamEvent {
  kind: string;
  lengthM: number | null;
}

/** G1: iplik kalemi (backend `YarnItemDto`) — BİRİM AÇIK (`unit`), `sarilan[]` kaynak beyanlı. */
export interface FasonYarnReturnRow {
  movementId: string;
  kind: "SUBCONTRACT_OUT_CANCEL" | "SUBCONTRACT_RETURN" | "SUBCONTRACT_RETURN_CANCEL";
  qtyKg: number;
  warehouseId: string;
  lotId: string | null;
  reasonCode: string | null;
}
export type YarnKgSource = "THEORETICAL" | "WEIGHED";
export interface FasonYarnItem {
  dispatchItemId: string;
  unit: "KG";
  item: { id: string; code: string; name: string };
  warehouseId: string;
  lotId: string | null;
  dispatchedKg: number;
  returnedKg: number;
  sarilanKg: number;
  sarilan: { beamNo: string; kg: number; kaynak: YarnKgSource | null }[];
  remainingKg: number;
  returns: FasonYarnReturnRow[];
}

export interface FasonDispatch {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  cancelledAt: string | null;
  plateNumber: string | null;
  driverName: string | null;
  items: { warpBeam: { id: string; beamNo: string; status: string } | null; events: FasonBeamEvent[] }[];
  /** G1: eski backend göndermez → `?? []` ile okunur. */
  yarnItems?: FasonYarnItem[];
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

export interface FasonYarnTotals {
  sentKg: number;
  returnedKg: number;
  woundKg: number;
  remainingKg: number;
}
export interface FasonTotals {
  sentM: number;
  returnedM: number;
  bornM: number;
  differenceM: number;
  /** G1: eski backend göndermez. */
  yarn?: FasonYarnTotals;
}

/** K1(b): fasoncudaki iplik — TÜRETİLMİŞ (kalem × lot), `sarilanKaynak` beyanlı. */
export interface FasonYarnBalanceRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotNo: string | null;
  outKg: number;
  returnedKg: number;
  sarilanKg: number;
  sarilanKaynak: YarnKgSource | "KARMA" | null;
  remainingKg: number;
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
