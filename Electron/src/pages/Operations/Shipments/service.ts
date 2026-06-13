import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ShipmentListItem, ShipmentDetail, BranchLookupItem } from "./types";

// Liste + cursor: createCrudService (GET /api/shipping/shipments?mode=cursor...).
// Detay ayrı tip (zengin) → getDetail. Backend listShipments cursor'u non-breaking.
const base = createCrudService<ShipmentListItem>("/api/shipping/shipments");

/** FilterBar şube filtresi için global şube lookup'ı (customer dahil). */
export const branchLookupService =
  createCrudService<BranchLookupItem>("/api/customer-branches");

export const shipmentService = {
  ...base,
  /** Tek sevkiyat detayı — açılınca lazy çekilir (liste değil). */
  getDetail: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient
      .get<ApiResponse<ShipmentDetail>>(`/api/shipping/shipments/${id}`)
      .then((r) => r.data),

  /** Saha #7: sevkiyatı yeniden hedefle — bağlı sipariş kümesini değiştir (replace). */
  retargetOrders: (id: string, orderIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/retarget-orders`, { orderIds })
      .then((r) => r.data),
};
