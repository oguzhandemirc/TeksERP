// =============================================================================
// FASON DEVERE — dönen levent kabulü · kabuller · mutabakat · kabul geri alma tipleri (D7a)
// =============================================================================
// Backend `services/warping-order/{receive,receipts,receive-cancel}.ts` + `helpers/warping-settlement.helper.ts`.
// Sayılar METİN (Decimal `toFixed(3)`); panel hesap yapmaz, yalnız biçimler.
// =============================================================================
import type { WarpingOrderStatus } from "./types";

export interface WarpingSettlementYarn {
  yarnItemId: string;
  code: string;
  name: string;
  letter: string;
  planNetKg: string;
  planGrossKg: string;
  dispatchedKg: string;
  returnedKg: string;
  transferInKg: string;
  transferOutKg: string;
  /** Bu siparişin canlı leventlerine sarılan nominal iplik. */
  woundKg: string;
  /** Sarılanın bu siparişin kalemlerinden düşen kısmı. */
  fromOwnKg: string;
  /** Sarılanın başka (kapanmış) siparişin kalanından düşen kısmı. */
  carryOverUsedKg: string;
  /** Deverecideki iplikten fazla nominal tüketim — dağıtılamadı. */
  unallocatedKg: string;
  /** Net canlı fire (kapanış + iade penceresi; geri alınanlar düşülmüş). Eski sunucuda yok. */
  wasteKg?: string;
  atSubcontractorKg: string;
}

export interface WarpingSettlement {
  metre: { targetM: string; receivedM: string; diffM: string; diffPct: string | null; planBeamCount: number | null; planBeamCountOpen?: boolean; receivedBeamCount: number };
  yarns: WarpingSettlementYarn[];
  weighing: { weighedBeamCount: number; weighedNetKg: string; nominalKg: string; diffKg: string; diffPct: string | null } | null;
}

export interface WarpingReceiptBeam {
  id: string;
  beamNo: string;
  status: string;
  physicalBeamNo: string | null;
  ownerCustomerId: string | null;
  lengthM: string | null;
  nominalKg: string | null;
  grossKg: string | null;
  tareKg: string | null;
  weighedNetKg: string | null;
  weighDiffKg: string | null;
  cancelled: boolean;
  yarns: Array<{ yarnItemId: string; kg: string; allocations: Array<{ dispatchItemId: string; holderWarpingOrderId: string; carryOver: boolean; kg: string }> }>;
}

export interface WarpingReceipt {
  receiptKey: string;
  deliveryNoteNo: string | null;
  receivedAt: string;
  beamCount: number;
  liveBeamCount: number;
  lengthM: string;
  beams: WarpingReceiptBeam[];
}

export interface WarpingReceipts {
  receipts: WarpingReceipt[];
  settlement: WarpingSettlement;
}

export interface WarpingReceiveBeamBody {
  lengthM: number;
  physicalBeamNo?: string | null;
  grossKg?: number | null;
  tareKg?: number | null;
}

export interface WarpingReceiveFields {
  deliveryNoteNo: string | null;
  beams: WarpingReceiveBeamBody[];
}

export interface WarpingReceivePreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus };
  beams: Array<{ index: number; lengthM: string; nominalKg: string; weighedNetKg: string | null; yarns: Array<{ yarnItemId: string; code: string; kg: string }> }>;
  allocations: Array<{
    beamIndex: number; yarnItemId: string; dispatchItemId: string; dispatchNo: string; lotNo: string | null;
    holderWarpingOrderId: string; holderOrderNo: string | null; carryOver: boolean; kg: string;
  }>;
  incoming: { beamCount: number; lengthM: string };
  before: WarpingSettlement;
  after: { receivedM: string; diffM: string; yarns: Array<{ yarnItemId: string; woundKg: string; unallocatedKg: string }> };
  ownerCustomerId: string | null;
  warnings: string[];
}

export interface WarpingReceiptCancelPreview {
  receiptKey: string;
  orderStatus: WarpingOrderStatus;
  beams: Array<{ id: string; beamNo: string; status: string; lengthM: string | null; cancellable: boolean; blocker: string | null }>;
  released: Array<{ dispatchItemId: string; dispatchNo: string; yarnItemId: string; holderWarpingOrderId: string; kg: string }>;
  blockers: string[];
  reasonRequired: true;
}
