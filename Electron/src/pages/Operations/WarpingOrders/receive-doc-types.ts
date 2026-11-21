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
