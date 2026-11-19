// =============================================================================
// FASON DEVERE — iplik sevki · sevk iptali · çözgü talimatı panel tipleri (D6b)
// =============================================================================
// Backend `services/warping-order/{dispatch,dispatch-cancel,dispatches-read,instruction}.ts` ile birebir;
// sayılar METİN gelir (Decimal `toFixed(3)`), panel hesaplamaz — yalnız biçimler ve satır içi uyarı üretir.
// =============================================================================
import type { WarpingOrderStatus } from "./types";

export type DevereLotPolicy = "FREE" | "WARN" | "SINGLE_LOT";

export interface WarpingDispatchPreviewYarn {
  yarnItemId: string;
  code: string;
  name: string;
  letter: string;
  endsCount: number;
  planNetKg: string;
  planGrossKg: string;
  dispatchedKg: string;
  returnedKg: string;
  transferInKg: string;
  transferOutKg: string;
  atSubcontractorKg: string;
  carryOverKg: string;
  suggestedKg: string;
  depoKg: string | null;
  shortageKg: string | null;
  /** Siparişin deverecide AÇIK duran ipliğinin lotları (lot kuralı bunlara göre işler). */
  lots: Array<{ lotId: string | null; lotNo: string | null; openKg: string }>;
}

export interface WarpingDispatchPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractorId: string };
  lotPolicy: DevereLotPolicy;
  lotRequired: boolean;
  ownerCustomerId: string | null;
  stock: { known: boolean };
  yarns: WarpingDispatchPreviewYarn[];
  warnings: string[];
}

export interface WarpingDispatchBody {
  clientToken: string;
  lines: Array<{ yarnItemId: string; warehouseId: string; lotId: string | null; qtyKg: number }>;
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface WarpingDispatchItem {
  dispatchItemId: string;
  yarnItemId: string;
  yarnItemCode: string;
  yarnItemName: string;
  warehouseId: string;
  warehouseName: string | null;
  lotId: string | null;
  lotNo: string | null;
  ownerCustomerId: string | null;
  outKg: string;
  returnedKg: string;
  transferOutKg: string;
  transferInKg: string;
  allocatedKg: string;
  holdingKg: string;
}

export interface WarpingDispatchRow {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  status: "ACTIVE" | "CANCELLED";
  cancelledAt: string | null;
  cancelReason: string | null;
  goodsReceiptId: string | null;
  totalOutKg: string;
  totalReturnedKg: string;
  totalTransferOutKg: string;
  totalTransferInKg: string;
  totalAllocatedKg: string;
  totalHoldingKg: string;
  canCancel: boolean;
  cancelBlockedReason: string | null;
  items: WarpingDispatchItem[];
}

export interface WarpingDispatchCancelPreview {
  dispatch: { id: string; dispatchNo: string; cancelledAt: string | null };
  canCancel: boolean;
  blockedReason: string | null;
  items: Array<{ dispatchItemId: string; yarnItemId: string; lotNo: string | null; warehouseId: string; outKg: string; returnedKg: string }>;
  orderReturnsToOpen: boolean;
}

export interface WarpingInstruction {
  orderNo: string;
  subcontractor: { code: string; name: string };
  warpSpec: { code: string; name: string };
  extraSpecs: Array<{ code: string; name: string }>;
  totalEnds: number;
  yarns: Array<{ letter: string; code: string; name: string; endsCount: number; denier: string }>;
  sequenceNote: string | null;
  reed: { reedNo: string | null; reedWidthCm: string | null; endsPerDent: number | null } | null;
  beamLines: Array<{ beamCount: number; beamLengthM: string }>;
  beamCount: number | null;
  /** Levent adedi devereciye bırakıldı; eski backend göndermez. */
  beamCountOpen?: boolean;
  targetLengthM: string;
  expectedReturnAt: string | null;
  notes: string | null;
}
