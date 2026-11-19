import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { OrderAllocationSummary, OrderLinkAllocationInput } from "./types";

/** İş emri planlama notu (backend `workorder-note.service`) — yalnız panel görür. */
export interface WorkOrderNoteView {
  workOrderId: string;
  body: string | null;
  updatedAt: string | null;
  updatedBy: { id: string; fullName: string } | null;
}

/** Planlama notunun tavanı — backend `WORK_ORDER_NOTE_MAX` / `@db.VarChar(2000)` aynası. */
export const WORK_ORDER_NOTE_MAX = 2000;

export const workOrderPlanningService = {
  /**
   * Metreyi AÇIK bağlara paylaştır (yalnız plan). Hata toast'ı bastırılır: cümle diyalogda
   * `details.code`tan kurulur (ALLOCATION_OVER_BASIS'te kalan pay satır içinde).
   */
  setOrderLinkAllocations: (id: string, allocations: OrderLinkAllocationInput[]) =>
    apiClient
      .put<ApiResponse<{ changed: number; warnings: string[]; allocation: OrderAllocationSummary }>>(
        `/api/work-orders/${id}/order-links/allocations`,
        { allocations },
        { suppressErrorToast: true },
      )
      .then((r) => r.data),

  getNote: (id: string) =>
    apiClient.get<ApiResponse<WorkOrderNoteView>>(`/api/work-orders/${id}/note`).then((r) => r.data),

  setNote: (id: string, body: string) =>
    apiClient.put<ApiResponse<WorkOrderNoteView>>(`/api/work-orders/${id}/note`, { body }).then((r) => r.data),
};
