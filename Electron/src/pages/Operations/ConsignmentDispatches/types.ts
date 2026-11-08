// =============================================================================
// EMANET ÇIKIŞ BELGESİ (F5) — TEL TİPLERİNİN PANEL AYNASI
// =============================================================================
// Tek kaynak backend `Teks-Erp/src/services/consignment-dispatch/types.ts` (istemci import edemez; ayna elle tutulur).
// Sayılar telde string, tarihler ISO. Top bu belgeye GİRMEZ: emanet top normal sevkiyattan çıkar (brüt sevk kuralı).
// =============================================================================

export type ConsignmentItemKind = "WARP_BEAM" | "YARN";

export type ConsignmentDispatchItemInput =
  | { kind: "WARP_BEAM"; warpBeamId: string }
  | { kind: "YARN"; yarnItemId: string; warehouseId: string; lotId: string; qtyKg: string };

export interface ConsignmentDispatchCreateInput {
  ownerCustomerId: string;
  items: ConsignmentDispatchItemInput[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
  clientToken?: string;
}

export interface ConsignmentDispatchItemDto {
  id: string;
  kind: ConsignmentItemKind;
  warpBeam: { id: string; beamNo: string; warpSpecName: string | null } | null;
  lengthM: string | null;
  yarnItem: { id: string; code: string; name: string } | null;
  warehouse: { id: string; name: string } | null;
  lot: { id: string; lotNo: string } | null;
  qtyKg: string | null;
}

export interface ConsignmentTotals {
  beamCount: number;
  beamLengthM: string;
  yarnKg: string;
}

export interface ConsignmentDispatchDto {
  id: string;
  dispatchNo: string;
  ownerCustomer: { id: string; code: string | null; name: string };
  dispatchedAt: string;
  dispatchedBy: { id: string; name: string } | null;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: ConsignmentDispatchItemDto[];
  totals: ConsignmentTotals;
}

export interface ConsignmentDispatchPreviewLine {
  kind: ConsignmentItemKind;
  refId: string;
  label: string;
  qty: string;
  unit: "METER" | "KG";
  ownerCustomerId: string | null;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

export interface ConsignmentDispatchPreview {
  ownerCustomer: { id: string; name: string };
  lines: ConsignmentDispatchPreviewLine[];
  totals: ConsignmentTotals;
  canCreate: boolean;
  warnings: string[];
}

export interface ConsignmentDispatchCancelPreview {
  id: string;
  dispatchNo: string;
  canCancel: boolean;
  blockedReason: ConsignmentDispatchErrorCode | null;
  affected: Array<{
    kind: ConsignmentItemKind;
    refId: string;
    label: string;
    qty: string;
    unit: "METER" | "KG";
  }>;
  billingLinks: Array<{
    linkId: string;
    warpBeamId: string;
    invoiceId: string;
    invoiceNo: string | null;
    invoiceStatus: string;
  }>;
}

export type ConsignmentStatusFilter = "ACTIVE" | "CANCELLED" | "ALL";

export interface ConsignmentDispatchListFilter {
  ownerCustomerId: string | null;
  status: ConsignmentStatusFilter;
  /** Fabrika günü `YYYY-MM-DD` (sunucu fabrika diliminde yorumlar). */
  from: string;
  to: string;
  search: string;
}

export const EMPTY_CONSIGNMENT_FILTER: ConsignmentDispatchListFilter = {
  ownerCustomerId: null,
  status: "ALL",
  from: "",
  to: "",
  search: "",
};

export interface ConsignmentDispatchListRow {
  id: string;
  dispatchNo: string;
  ownerCustomer: { id: string; name: string };
  dispatchedAt: string;
  cancelledAt: string | null;
  beamCount: number;
  beamLengthM: string;
  yarnKg: string;
}

export interface ConsignmentDispatchListResult {
  data: ConsignmentDispatchListRow[];
  nextCursor: string | null;
  summary: { count: number; activeCount: number; beamCount: number; yarnKg: string };
}

export type ConsignmentDispatchErrorCode =
  | "CONSIGNMENT_ITEMS_EMPTY"
  | "CONSIGNMENT_OWNER_MISMATCH"
  | "CONSIGNMENT_BEAM_NOT_READY"
  | "CONSIGNMENT_YARN_INSUFFICIENT"
  | "YARN_LOT_INACTIVE"
  | "CONSIGNMENT_DISPATCH_CANCELLED"
  | "CONSIGNMENT_DISPATCH_CHANGED"
  | "CONSIGNMENT_BEAM_MOVED_AFTER"
  | "CONSIGNMENT_BEAM_INVOICED"
  | "CLIENT_TOKEN_COLLISION";

/** `GET /api/consignment-dispatches/candidates` — backend `candidate-types.ts` aynası. Dolu `blockedReason` seçilemez. */
export interface ConsignmentBeamCandidate {
  warpBeamId: string;
  beamNo: string;
  warpSpecName: string | null;
  remainingM: string;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

export interface ConsignmentYarnCandidate {
  lotId: string;
  lotNo: string;
  yarnItemId: string;
  itemCode: string;
  itemName: string;
  warehouseId: string;
  warehouseName: string;
  balanceKg: string;
  blockedReason: ConsignmentDispatchErrorCode | null;
}

export interface ConsignmentCandidates {
  ownerCustomer: { id: string; name: string };
  modules: { devere: boolean; iplik: boolean };
  beams: ConsignmentBeamCandidate[];
  yarns: ConsignmentYarnCandidate[];
  truncated: { beams: boolean; yarns: boolean };
}
