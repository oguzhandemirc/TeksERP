import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** `POST /work-orders/:id/batches` yanıtı. */
export type AddBatchResult = { batch: { id: string; batchNumber: string } | null; rollCount: number; warnings: string[]; replay: boolean };

export const workOrderBatchService = {
  /** Parti Ekle (hareket defteri D8) — okutulan stok topları YENİ parti olur, ilk adımdan başlar; aynı `clientToken` önceki sonucu döner. */
  addBatch: (id: string, data: { clientToken: string; rollBarcodes: string[]; reason?: string }): Promise<ApiResponse<AddBatchResult>> =>
    apiClient.post<ApiResponse<AddBatchResult>>(`/work-orders/${id}/batches`, data).then((r) => r.data),
};
