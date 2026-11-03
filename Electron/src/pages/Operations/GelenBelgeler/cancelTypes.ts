// Onaylı gelen belge iptali (K15) — sunucu `gelen-belge-iptal-onizleme.service.ts` yanıtının aynası.
import type { NoteStatus } from "./types";

export type CancelBlockerCode =
  | "ROLL_STATUS" | "ROLL_IN_SHIPMENT" | "ROLL_WAREHOUSE_MISSING" | "ROLL_OPERATION" | "ROLL_METER_READING"
  | "ROLL_SERVICE_BILLING" | "ROLL_SUBCONTRACTOR_DISPATCH" | "ROLL_KARTELA_DISPATCH" | "ROLL_RETURN" | "ROLL_CHILDREN"
  | "ROLL_INSPECTION" | "ROLL_ERROR" | "ROLL_LAB_TEST" | "ROLL_SWATCH"
  | "ROLL_PROCESSED" | "WORK_ORDER_STARTED" | "WORK_ORDER_NOT_SELECTED";

export interface CancelBlocker {
  code: CancelBlockerCode;
  message: string;
  rollId?: string;
  workOrderId?: string;
}

export interface CancelPreviewRoll {
  rollId: string;
  barcode: string | null;
  lineNo: number;
  senderRollNo: string | null;
  meters: string;
  status: string;
  location: string | null;
  outcome: "CANCEL" | "SKIP" | "BLOCKED";
  blockers: CancelBlocker[];
}

export interface CancelPreviewWorkOrder {
  id: string;
  workOrderNumber: string;
  status: string;
  selectable: boolean;
  noteRollCount: number;
  otherRollCount: number;
  effect: string;
}

export interface NoteCancelPreview {
  note: { id: string; noteNo: string; status: NoteStatus; senderDocNo: string | null; ownerName: string | null };
  cancellable: boolean;
  rolls: CancelPreviewRoll[];
  workOrders: CancelPreviewWorkOrder[];
  blockers: CancelBlocker[];
  summary: { rollCount: number; cancelRollCount: number; cancelMeters: string; workOrderCount: number };
}

export interface NoteCancelResult {
  note: { id: string; noteNo: string; status: NoteStatus; cancelledAt: string | null; cancelReason: string | null };
  cancelledRollCount: number;
  cancelledWorkOrders: Array<{ id: string; workOrderNumber: string }>;
}
