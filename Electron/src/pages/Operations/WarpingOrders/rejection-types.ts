// =============================================================================
// FASON DEVERE — kusurlu sarım reddi (ret belgesi DR-…) tipleri (devere ek C2)
// =============================================================================
// Backend `services/warping-order/beam-rejection{,-cancel,-read}.ts` (C1, #818). Sayılar METİN (Decimal
// `toFixed(3)`); panel hesap yapmaz. Detay DTO'su aynı zamanda basım verisidir (donmuş PrintedDocument yok).
// =============================================================================
import type { WarpBeamStatus } from "@/pages/Operations/WarpBeams/types";
import type { WarpingOrderStatus } from "./types";

export interface RejectBlocker { code: string; message: string }

/** Retle deverecinin tutmasına dönecek iplik (kalem × tutan sipariş). */
export interface RejectYarnLine {
  yarnItemId: string; code: string; name: string; dispatchItemId: string; dispatchNo: string; lotNo: string | null;
  holderWarpingOrderId: string; holderOrderNo: string; kg: string;
}

export interface WarpingBeamRejectionFields {
  warpingOrderId: string;
  beamIds: string[];
  reasonCode: string;
  reasonText?: string | null;
  notes?: string | null;
  /** true = "yeniden sarılsın", false = "iptal, iplik deverecide kalsın". */
  expectRework: boolean;
  rejectedAt?: string | null;
}

export interface RejectPhotoInput { fileName: string | null; contentBase64: string }

export interface WarpingBeamRejectionPreview {
  order: { id: string; orderNo: string; status: WarpingOrderStatus; subcontractor: { id: string; code: string; name: string } };
  beams: Array<{
    id: string; beamNo: string; status: WarpBeamStatus; lengthM: string | null; nominalKg: string | null; bodyNo: string | null;
    receiptKey: string | null; deliveryNoteNo: string | null; receivedAt: string | null; invoiceDocNo: string | null; blocker: string | null;
  }>;
  returnedYarn: RejectYarnLine[];
  totals: { beamCount: number; lengthM: string; nominalKg: string; returnedKg: string };
  reason: { code: string; text: string } | null;
  photoRequired: boolean;
  blockers: RejectBlocker[];
  warnings: string[];
  rejectable: boolean;
}

export interface WarpingBeamRejectionItem {
  beamId: string; beamNo: string; status: WarpBeamStatus; bodyNo: string | null; lengthM: string | null; nominalKg: string | null; endsCount: number | null;
  deliveryNoteNo: string | null; receivedAt: string | null; reversed: boolean; rework: { id: string; beamNo: string } | null;
}

export interface WarpingBeamRejection {
  id: string;
  docNo: string;
  status: "ACTIVE" | "CANCELLED";
  mode: "REWORK" | "CANCEL";
  order: { id: string; orderNo: string; warpSpec: { code: string; name: string } };
  subcontractor: { id: string; code: string; name: string };
  reason: { code: string; text: string };
  notes: string | null;
  rejectedAt: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  totals: { beamCount: number; lengthM: string; nominalKg: string };
  items: WarpingBeamRejectionItem[];
  photos: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}

export interface WarpingBeamRejectionPage {
  data: WarpingBeamRejection[];
  nextCursor: string | null;
  summary: { count: number; beamCount: number };
}

export interface WarpingBeamRejectionCancelPreview {
  doc: WarpingBeamRejection;
  cancellable: boolean;
  blockers: RejectBlocker[];
  items: Array<{ beamId: string; beamNo: string; status: WarpBeamStatus; blocker: string | null }>;
  yarn: Array<RejectYarnLine & { holdingKg: string; enough: boolean }>;
  reasonRequired: true;
}
