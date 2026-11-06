import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** `GET /work-orders/where-options` — tablet yalnız istasyon seçeneklerini okur (eski sunucuda `stations` yok → boş). */
export interface WorkOrderWhereOptions {
  firms: { id: string; name: string; workOrderCount: number }[];
  stations?: { id: string; name: string; kind: string; dis: boolean }[];
}

export const workOrderWhereOptionsService = {
  get: (): Promise<WorkOrderWhereOptions> =>
    apiClient.get<ApiResponse<WorkOrderWhereOptions>>('/work-orders/where-options').then((r) => r.data.data),
};
