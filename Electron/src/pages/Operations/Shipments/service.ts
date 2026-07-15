import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  ShipmentListItem,
  ShipmentDetail,
  DirectShipmentDetail,
  BranchLookupItem,
} from "./types";

// Liste + cursor: createCrudService (GET /api/shipping/shipments?mode=cursor...).
// Detay ayrı tip (zengin) → getDetail. Backend listShipments cursor'u non-breaking.
const base = createCrudService<ShipmentListItem>("/api/shipping/shipments");

/** FilterBar şube filtresi için global şube lookup'ı (customer dahil). */
export const branchLookupService = createCrudService<BranchLookupItem>("/api/customer-branches");

export const shipmentService = {
  ...base,
  /** Tek sevkiyat detayı — açılınca lazy çekilir (liste değil). */
  getDetail: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient.get<ApiResponse<ShipmentDetail>>(`/api/shipping/shipments/${id}`).then((r) => r.data),

  /** Fasondan doğrudan sevk (DirectShipment) detayı — birleşik listeden DIRECT satırı açılınca. */
  getDirectShipmentDetail: (id: string): Promise<ApiResponse<DirectShipmentDetail>> =>
    apiClient
      .get<ApiResponse<DirectShipmentDetail>>(`/api/shipping/direct-shipments/${id}`)
      .then((r) => r.data),

  /** İptal önizlemesi — havuza dönecek çuval/top + rezervi serbest kalacak sipariş dökümü (yıkıcı-onay). */
  cancelPreview: (id: string): Promise<ApiResponse<CancelPreview>> =>
    apiClient
      .get<ApiResponse<CancelPreview>>(`/api/shipping/shipments/${id}/cancel-preview`)
      .then((r) => r.data),

  /** Sevkiyatı iptal et (CANCELLED) — çuvallar depoya döner, tahsisler silinir (sipariş bağı kalkar). */
  cancel: (id: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/cancel`, {}).then((r) => r.data),
};

/** İptal önizleme yanıtı (backend getCancelPreview ile eşleşir — havuz modeli, rolls[] YOK). */
export interface CancelPreview {
  shipmentId: string;
  shipmentNo: string;
  status: string;
  customerName: string;
  branchName: string | null;
  canCancel: boolean;
  reason: string | null;
  sackCount: number;
  rollCount: number;
  swatchCount: number;
  affectedOrders: { orderNumber: string; qty: string }[];
}
