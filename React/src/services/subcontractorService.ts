import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  SubcontractorDispatch,
  SubcontractorReceipt,
  PendingReturnGroup,
} from "@/types/models";

export interface DispatchRequest {
  workOrderId: string;
  stepId: string;
  companyId: string;
  rollIds: string[];
  plateNumber?: string;
  driverName?: string;
  notes?: string;
}

export interface ReceiveReturnItem {
  rollId: string;
  notes?: string | null;
}

export interface ReceiveRequest {
  workOrderId: string;
  stepId: string;
  companyId: string;
  manifestNo: string;
  returns: ReceiveReturnItem[];
  notes?: string;
}

export const subcontractorService = {
  dispatch(data: DispatchRequest): Promise<ApiResponse<SubcontractorDispatch>> {
    return apiClient
      .post<ApiResponse<SubcontractorDispatch>>("/api/subcontractor/dispatch", data)
      .then((r) => r.data);
  },

  receive(data: ReceiveRequest): Promise<ApiResponse<SubcontractorReceipt>> {
    return apiClient
      .post<ApiResponse<SubcontractorReceipt>>("/api/subcontractor/receive", data)
      .then((r) => r.data);
  },

  pendingReturns(): Promise<ApiResponse<PendingReturnGroup[]>> {
    return apiClient
      .get<ApiResponse<PendingReturnGroup[]>>("/api/subcontractor/pending-returns")
      .then((r) => r.data);
  },

  listDispatches(params?: {
    workOrderId?: string;
    companyId?: string;
    limit?: number;
  }): Promise<ApiResponse<SubcontractorDispatch[]>> {
    const q = new URLSearchParams();
    if (params?.workOrderId) q.set("workOrderId", params.workOrderId);
    if (params?.companyId) q.set("companyId", params.companyId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<SubcontractorDispatch[]>>(
        `/api/subcontractor/dispatches${qs ? `?${qs}` : ""}`,
      )
      .then((r) => r.data);
  },

  getDispatch(id: string): Promise<ApiResponse<SubcontractorDispatch>> {
    return apiClient
      .get<ApiResponse<SubcontractorDispatch>>(`/api/subcontractor/dispatches/${id}`)
      .then((r) => r.data);
  },

  listReceipts(params?: {
    workOrderId?: string;
    companyId?: string;
    limit?: number;
  }): Promise<ApiResponse<SubcontractorReceipt[]>> {
    const q = new URLSearchParams();
    if (params?.workOrderId) q.set("workOrderId", params.workOrderId);
    if (params?.companyId) q.set("companyId", params.companyId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<SubcontractorReceipt[]>>(
        `/api/subcontractor/receipts${qs ? `?${qs}` : ""}`,
      )
      .then((r) => r.data);
  },

  getReceipt(id: string): Promise<ApiResponse<SubcontractorReceipt>> {
    return apiClient
      .get<ApiResponse<SubcontractorReceipt>>(`/api/subcontractor/receipts/${id}`)
      .then((r) => r.data);
  },

  getReceiptPrint(id: string): Promise<ApiResponse<SubcontractorReceiptPrintSnapshot>> {
    return apiClient
      .get<ApiResponse<SubcontractorReceiptPrintSnapshot>>(`/api/subcontractor/receipts/${id}/print`)
      .then((r) => r.data);
  },

  getDispatchPrint(id: string): Promise<ApiResponse<SubcontractorDispatchPrintSnapshot>> {
    return apiClient
      .get<ApiResponse<SubcontractorDispatchPrintSnapshot>>(`/api/subcontractor/dispatches/${id}/print`)
      .then((r) => r.data);
  },
};

export interface SubcontractorDispatchPrintSnapshot {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  workOrder: {
    id: string;
    batchNumber: string;
    recipeNo: string | null;
    parameters: Record<string, unknown> | null;
    type: string;
  };
  company: {
    id: string;
    name: string;
    code: string | null;
  };
  step: {
    id: string;
    stepSequence: number;
    station: { name: string; code: string };
  };
  rolls: Array<{
    sequence: number;
    id: string;
    barcode: string;
    itemCode: string;
    itemName: string;
    variantCode: string | null;
    variantName: string | null;
    dispatchedQty: number;
    dispatchedWeight: number | null;
    qualityGrade: string;
    width: number | null;
  }>;
  totals: {
    rollCount: number;
    totalQty: number;
    totalWeight: number;
  };
}

export interface SubcontractorReceiptPrintSnapshot {
  receiptNo: string;
  manifestNo: string;
  receivedAt: string;
  notes: string | null;
  receivedBy: string | null;
  workOrder: {
    id: string;
    batchNumber: string;
    recipeNo: string | null;
    type: string;
  };
  company: {
    id: string;
    name: string;
    code: string | null;
  };
  step: {
    id: string;
    stepSequence: number;
    station: { name: string; code: string };
  };
  rolls: Array<{
    sequence: number;
    id: string;
    barcode: string;
    itemCode: string;
    itemName: string;
    variantCode: string | null;
    variantName: string | null;
    qualityGrade: string;
    notes: string | null;
  }>;
  totals: { rollCount: number };
}
