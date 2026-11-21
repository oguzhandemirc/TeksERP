// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ tipleri (devere ek E2; backend E1 `/api/warping-receive-docs`)
// =============================================================================
// Backend `services/warping-order/receive-doc{,-read}.ts` aynası. Sayılar METİN; panel hesap yapmaz.
// Sipariş başı kabul DTO'su tek sipariş ucuyla aynı (`WarpingReceipt`), önizleme de (`WarpingReceivePreview`).
// =============================================================================
import type { WarpingReceipt, WarpingReceiveBeamBody, WarpingReceivePreview } from "./receive-types";

export interface DeliveryNoteUse { orderNo: string; docNo: string | null; receivedAt: string }

export interface WarpingReceiveDocOrderInput { warpingOrderId: string; beams: WarpingReceiveBeamBody[] }

export interface WarpingReceiveDocFields {
  subcontractorId: string | null;
  deliveryNoteNo: string | null;
  orders: WarpingReceiveDocOrderInput[];
}

export interface WarpingReceiveDocPreview {
  subcontractorId: string;
  deliveryNoteNo: string | null;
  /** Bu irsaliye no ile yapılmış önceki canlı kabuller (ayar ALLOW'da boş). */
  deliveryNoteUses: DeliveryNoteUse[];
  orders: Array<{ warpingOrderId: string; preview: WarpingReceivePreview }>;
  totals: { orderCount: number; beamCount: number; lengthM: string };
  /** Önce irsaliye uyarıları, sonra "<sipariş no>: …" önekli sipariş uyarıları. */
  warnings: string[];
}

export interface WarpingReceiveDoc {
  id: string;
  docNo: string;
  deliveryNoteNo: string | null;
  createdAt: string;
  createdById: string | null;
  subcontractor: { id: string; code: string; name: string };
  orders: Array<{ warpingOrderId: string; orderNo: string; receipt: WarpingReceipt }>;
  totals: { orderCount: number; beamCount: number; liveBeamCount: number; lengthM: string };
}

/** E6 belge stornosu önizlemesi (`GET /:id/cancel-preview`) — etkilenen her sipariş/levent; engel varsa hiçbiri geri alınmaz. */
export interface WarpingReceiveDocCancelPreview {
  doc: { id: string; docNo: string; deliveryNoteNo: string | null; subcontractor: { id: string; code: string; name: string } };
  orders: Array<{
    warpingOrderId: string; orderNo: string; receiptKey: string; orderStatus: string; alreadyCancelled: boolean;
    beams: Array<{ id: string; beamNo: string; status: string; lengthM: string | null; live: boolean; cancellable: boolean; blocker: string | null }>;
    released: Array<{ dispatchItemId: string; dispatchNo: string; yarnItemId: string; yarnCode: string; yarnName: string; holderWarpingOrderId: string; holderOrderNo: string; kg: string }>;
    blockers: string[];
  }>;
  blockers: string[];
  cancellable: boolean;
  totals: { orderCount: number; beamCount: number; lengthM: string };
  reasonRequired: true;
}

export interface WarpingReceiveDocRow {
  id: string;
  docNo: string;
  deliveryNoteNo: string | null;
  createdAt: string;
  createdById: string | null;
  subcontractor: { id: string; code: string; name: string };
  beamCount: number;
  orders: Array<{ warpingOrderId: string; orderNo: string }>;
}

export interface WarpingReceiveDocSummary { count: number; beamCount: number }

export interface DeliveryNoteGroup {
  subcontractorId: string;
  deliveryNoteNo: string;
  docs: WarpingReceiveDoc[];
  /** Belgesiz (eski tek-sipariş) kabuller — aynı irsaliye no. */
  receipts: Array<{ warpingOrderId: string; orderNo: string; receipt: WarpingReceipt }>;
}
