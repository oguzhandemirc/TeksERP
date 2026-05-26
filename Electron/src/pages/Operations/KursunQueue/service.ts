import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { KursunQueueItem } from "./types";

interface ReorderItem {
  id: string; // WorkOrderStep.id
  priority: number;
}

export const kursunQueueService = {
  list: (): Promise<ApiResponse<KursunQueueItem[]>> =>
    apiClient
      .get<ApiResponse<KursunQueueItem[]>>("/api/kursun-qc/queue")
      .then((r) => r.data),

  reorder: (
    items: ReorderItem[],
  ): Promise<ApiResponse<{ updated: number }>> =>
    apiClient
      .patch<ApiResponse<{ updated: number }>>("/api/kursun-qc/queue/reorder", {
        items,
      })
      .then((r) => r.data),

  setUrgent: (
    stepId: string,
    isUrgent: boolean,
  ): Promise<
    ApiResponse<{
      id: string;
      isUrgent: boolean;
      urgentMarkedAt: string | null;
    }>
  > =>
    apiClient
      .patch<
        ApiResponse<{
          id: string;
          isUrgent: boolean;
          urgentMarkedAt: string | null;
        }>
      >(`/api/kursun-qc/queue/${stepId}/urgent`, { isUrgent })
      .then((r) => r.data),
};
