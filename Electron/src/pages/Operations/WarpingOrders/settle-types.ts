// =============================================================================
// FASON DEVERE — kapanış · kapanış geçmişi · yeniden açma tipleri (D7b)
// =============================================================================
// Backend `services/warping-order/{settle,settle-record,reopen}.ts` + `helpers/warping-settle-plan.helper.ts`.
// Sayılar METİN (Decimal `toFixed`); panel hesap yapmaz, yalnız biçimler.
// =============================================================================
import type { WarpingOrderStatus } from "./types";
import type { WarpingSettlement } from "./receive-types";

export interface WarpingSettlePlanLine {
  dispatchItemId: string;
  dispatchId: string;
  dispatchNo: string;
  yarnItemId: string;
  lotId: string | null;
  lotNo: string | null;
  own: boolean;
  holdingKg: string;
  returnKg: string;
  wasteKg: string;
  keepKg: string;
}

export interface WarpingSettlePlanYarn {
  yarnItemId: string;
  code: string;
  plannedWasteKg: string;
  woundKg: string;
  holdingKg: string;
  returnKg: string;
  wasteKg: string;
  /** Bu ipliğe daha önce (iade penceresinde) yazılmış canlı fire — fire %ye girer; eski sunucuda yok. */
  priorWasteKg?: string;
  keepKg: string;
  wastePct: string | null;
  overTolerance: boolean;
}

export interface WarpingSettlePreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  canSettle: boolean;
  blockers: string[];
  plan: {
    isDefault: boolean;
    wastePct: string | null;
    tolerancePct: string | null;
    overTolerance: boolean;
    lines: WarpingSettlePlanLine[];
    yarns: WarpingSettlePlanYarn[];
  };
  settlement: WarpingSettlement;
  warnings: string[];
}

export interface WarpingSettleLineBody {
  dispatchItemId: string;
  returnKg?: number;
  wasteKg?: number;
  returnReasonCode?: string | null;
  warehouseId?: string | null;
}

export interface WarpingSettleFields {
  reason?: string | null;
  returnReasonCode?: string | null;
  lines?: WarpingSettleLineBody[];
}

export interface WarpingSettlementRecord {
  id: string;
  warpingOrderId: string;
  kind: string;
  reason: string | null;
  wastePct: string | null;
  tolerancePct: string | null;
  overTolerance: boolean;
  createdAt: string;
  createdById: string | null;
  reopened: { id: string; createdAt: string; reason: string | null } | null;
  reversesId: string | null;
  totalWasteKg: string;
  totalReturnKg: string;
  wastes: Array<{ id: string; kind: string; dispatchItemId: string; dispatchNo: string; yarnItemId: string; code: string; name?: string; lotNo: string | null; qtyKg: string; overTolerance: boolean; reversesId: string | null }>;
  returns: Array<{ movementId: string; dispatchItemId: string | null; yarnItemId: string; qtyKg: string; warehouseId: string; lotId: string | null; reasonCode: string | null }>;
  backTransferIds: string[];
}

export interface WarpingReopenPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  canReopen: boolean;
  blockers: string[];
  settlement: WarpingSettlementRecord | null;
  wastesToCancel: Array<{ wasteId: string; dispatchItemId: string; qtyKg: string }>;
  returnsToCancel: Array<{ movementId: string; dispatchItemId: string | null; qtyKg: string }>;
  transfersToCancel: Array<{ transferId: string; dispatchItemId: string; qtyKg: string }>;
}
