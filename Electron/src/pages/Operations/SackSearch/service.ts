import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  CreatedShipment,
  CreateShipmentPreview,
  LocatedRoll,
  PickListRow,
  SackContents,
  SackSearchParams,
  SackSearchResponse,
  ShipmentDestination,
} from "./types";

/**
 * Çuval/Top Arama + HAVUZDAN SEVKİYAT KURMA servisi. Arama salt-okunur, cursor sayfalı.
 * Sevkiyat kurma: seçilen mühürlü havuz çuvallarından POST /shipments {sackIds}.
 */
export const sackSearchService = {
  search: (params: SackSearchParams = {}): Promise<SackSearchResponse> => {
    const sp = new URLSearchParams();
    if (params.itemId) sp.set("itemId", params.itemId);
    if (params.colorId) sp.set("colorId", params.colorId);
    if (params.width !== undefined) sp.set("width", String(params.width));
    if (params.customerId) sp.set("customerId", params.customerId);
    if (params.scope) sp.set("scope", params.scope);
    if (params.shipmentNo) sp.set("shipmentNo", params.shipmentNo);
    if (params.sackCode) sp.set("sackCode", params.sackCode);
    if (params.includeDispatched) sp.set("includeDispatched", "true");
    if (params.cursor) sp.set("cursor", params.cursor);
    if (params.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return apiClient
      .get<SackSearchResponse>(`/api/shipping/sack-search${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },

  contents: (sackId: string): Promise<ApiResponse<SackContents>> =>
    apiClient.get<ApiResponse<SackContents>>(`/api/shipping/sacks/${sackId}/contents`).then((r) => r.data),

  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(`/api/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),

  /** Çeki listesi — seçilen çuvalların içerik özetli dökümü (salt-okunur POST). */
  pickList: (sackIds: string[]): Promise<ApiResponse<PickListRow[]>> =>
    apiClient
      .post<ApiResponse<PickListRow[]>>(`/api/shipping/sack-search/pick-list`, { sackIds })
      .then((r) => r.data),

  /** Sevkiyat kurulum önizlemesi (salt-okunur) — içerik + donacak sipariş tahsisleri. */
  previewShipment: (sackIds: string[]): Promise<ApiResponse<CreateShipmentPreview>> =>
    apiClient
      .post<ApiResponse<CreateShipmentPreview>>(`/api/shipping/shipments/preview`, { sackIds })
      .then((r) => r.data),

  /** Seçilen mühürlü havuz çuvallarından yeni sevkiyat kur (PLANNED). */
  createShipment: (
    sackIds: string[],
    destination?: ShipmentDestination,
    procedureCode?: string | null,
  ): Promise<ApiResponse<CreatedShipment>> =>
    apiClient
      .post<ApiResponse<CreatedShipment>>(`/api/shipping/shipments`, {
        sackIds,
        ...(destination ? { destination } : {}),
        ...(procedureCode ? { procedureCode } : {}),
      })
      .then((r) => r.data),
};
