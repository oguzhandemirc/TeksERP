// Masraf bağı API istemcisi (D4-H3). Yazma uçları `suppressErrorToast` ile gider: hata diyalog içinde basılır
// (`cashTxnErrorText`, kasa ekranının sözleşmesi). Yollar TAM ("/api/finance/...").
import apiClient from "@/services/apiClient";
import type { CrudService } from "@/services/crudService";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import type { WorkOrder } from "@/pages/Operations/WorkOrders/types";
import type { AllocationBody, AllocationTargetType } from "./allocationRules";

export interface ExpenseAllocationRow {
  id: string;
  cashTransactionId: string;
  targetType: AllocationTargetType;
  targetLabel: string;
  sharePct: string;
  createdAt: string;
  createdByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
}

export interface ExpenseAllocationList {
  rows: ExpenseAllocationRow[];
  activePct: string;
  remainingPct: string;
}

export async function listExpenseAllocations(cashTransactionId: string): Promise<ExpenseAllocationList> {
  const res = await apiClient.get(`/api/finance/cash-transactions/${cashTransactionId}/allocations`);
  return (res.data as { data: ExpenseAllocationList }).data;
}

export async function createExpenseAllocation(cashTransactionId: string, body: AllocationBody, clientToken: string) {
  const res = await apiClient.post(`/api/finance/cash-transactions/${cashTransactionId}/allocations`, { ...body, clientToken }, { suppressErrorToast: true });
  return res.data as { data: ExpenseAllocationRow; message?: string };
}

export async function revokeExpenseAllocation(allocationId: string, reason: string) {
  const res = await apiClient.post(`/api/finance/expense-allocations/${allocationId}/revoke`, { reason }, { suppressErrorToast: true });
  return res.data as { data: ExpenseAllocationRow; message?: string };
}

/**
 * İş emri seçicisi: ortak seçici modal her listeye `isActive` süzgeci ekler; iş emrinde öyle kolon yok →
 * süzgeç çıkarılır, en yeni iş emri üstte gelir.
 */
export const workOrderPickerService: CrudService<WorkOrder> = {
  ...workOrderService,
  listCursor: (params) => {
    const filters = { ...params.filters };
    delete filters.isActive;
    return workOrderService.listCursor({ ...params, filters, sortBy: "createdAt", sortOrder: "desc" });
  },
};
