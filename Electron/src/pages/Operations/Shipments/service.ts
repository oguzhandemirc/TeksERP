import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ShipmentListItem, ShipmentDetail } from "./types";

// Liste + cursor: createCrudService (GET /api/shipping/shipments?mode=cursor...).
// Detay ayrı tip (zengin) → getDetail. Backend listShipments cursor'u non-breaking.
const base = createCrudService<ShipmentListItem>("/api/shipping/shipments");

export const shipmentService = {
  ...base,
  /** Tek sevkiyat detayı — açılınca lazy çekilir (liste değil). */
  getDetail: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient
      .get<ApiResponse<ShipmentDetail>>(`/api/shipping/shipments/${id}`)
      .then((r) => r.data),
};
