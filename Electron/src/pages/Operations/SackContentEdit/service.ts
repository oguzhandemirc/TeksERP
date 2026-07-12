import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  AddKartelaResult,
  CreatedShipment,
  CreateShipmentPreview,
  CustomerPool,
  KartelaStockGroup,
  LocatedRoll,
  OpenedSack,
  OpenOrder,
  PickListRow,
  SackContents,
  SackSearchParams,
  SackSearchResponse,
  ScanResult,
  ShipmentDestination,
} from "./types";

/**
 * Çuval Deposu / Paketleme hub servisi — backend /api/shipping (Çuval Depo modeli).
 * Tek geçit: arama (cursor) + çuval içerik düzenleme (aç/okut/tart/çıkar/taşı/sil) +
 * havuzdan sevkiyat kurma (önizleme + oluştur). Mühür/seal ve packedQty YOK.
 * apiClient interceptor hata mesajını zaten toast'lar → mutation'da onError yok.
 */
export const sackHubService = {
  // ── Arama (salt-okunur, cursor sayfalı) ────────────────────────────────────
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
    return apiClient.get<SackSearchResponse>(`/api/shipping/sack-search${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },

  /** Tek çuvalın dökümü — arama detayı (lazy) + editör içerik kaynağı. */
  contents: (sackId: string): Promise<ApiResponse<SackContents>> =>
    apiClient.get<ApiResponse<SackContents>>(`/api/shipping/sacks/${sackId}/contents`).then((r) => r.data),

  /** Top yerini bul — barkod tam eşleşme ("bu top nerede?"). */
  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(`/api/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),

  /** Çeki listesi — seçilen çuvalların içerik özetli dökümü (salt-okunur POST). */
  pickList: (sackIds: string[]): Promise<ApiResponse<PickListRow[]>> =>
    apiClient.post<ApiResponse<PickListRow[]>>(`/api/shipping/sack-search/pick-list`, { sackIds }).then((r) => r.data),

  // ── Sipariş rehberi + müşteri havuzu ───────────────────────────────────────
  /** Açık siparişler + depo karşılaması (sevkiyat sipariş seçimi rehberi). */
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.branchId) q.set("branchId", params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/api/shipping/open-orders${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },

  /** Müşterinin depo çuvalları (+içerik) — taşıma hedefleri için. */
  listCustomerPool: (customerId: string): Promise<ApiResponse<CustomerPool>> =>
    apiClient
      .get<ApiResponse<CustomerPool>>(`/api/shipping/pool/sacks?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.data),

  // ── Çuval içerik düzenleme (depodaki çuval — her zaman düzenlenebilir) ──────
  /** Yeni depo çuvalı aç — müşteri/şube OPSİYONEL (müşterisiz genel stok da olur). */
  openSack: (body: { customerId?: string | null; branchId?: string | null }): Promise<ApiResponse<OpenedSack>> =>
    apiClient
      .post<ApiResponse<OpenedSack>>(`/api/shipping/sacks`, {
        ...(body.customerId ? { customerId: body.customerId } : {}),
        ...(body.branchId ? { branchId: body.branchId } : {}),
      })
      .then((r) => r.data),

  /** Barkod okut → top/kartelayı çuvala ekle/taşı. */
  scanIntoSack: (sackId: string, barcode: string): Promise<ApiResponse<ScanResult>> =>
    apiClient.post<ApiResponse<ScanResult>>(`/api/shipping/sacks/${sackId}/scan`, { barcode }).then((r) => r.data),

  /** Çuvalı tart (brüt kg). */
  weighSack: (sackId: string, weightKg: number): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/sacks/${sackId}/weigh`, { weightKg }).then((r) => r.data),

  /** Çuval sil (boş) veya withContents=true → içeriği depoya döndürüp sil. */
  removeSack: (sackId: string, withContents?: boolean): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/sacks/${sackId}/remove`, withContents ? { withContents: true } : {})
      .then((r) => r.data),

  /** Topu çuvaldan çıkar (depoya döner). */
  removeRollFromSack: (rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/rolls/${rollId}/remove-from-sack`, {}).then((r) => r.data),

  /** Kartelayı çuvaldan çıkar. */
  removeSwatchFromSack: (swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/swatches/${swatchId}/remove-from-sack`, {}).then((r) => r.data),

  /** Topu başka depo çuvalına taşı. */
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/rolls/${rollId}/move-sack`, { sackId }).then((r) => r.data),

  /** Kartela stoğu (ürün+renk bazında müsait adet). */
  listKartelaStock: (search?: string): Promise<ApiResponse<KartelaStockGroup[]>> =>
    apiClient
      .get<ApiResponse<KartelaStockGroup[]>>(`/api/kartela/stock${search ? `?search=${encodeURIComponent(search)}` : ""}`)
      .then((r) => r.data),

  /** Seçerek kartela ekle (barkodsuz) — çuvala N adet. */
  addKartela: (
    sackId: string,
    body: { itemId: string; colorId: string | null; count: number },
  ): Promise<ApiResponse<AddKartelaResult>> =>
    apiClient.post<ApiResponse<AddKartelaResult>>(`/api/shipping/sacks/${sackId}/add-kartela`, body).then((r) => r.data),

  // ── Sevkiyat kurma (havuzdan çuval seçerek) ────────────────────────────────
  /** Sevkiyat kurulum önizlemesi (salt-okunur) — içerik + tahsis + uyarılar. */
  previewShipment: (body: {
    sackIds: string[];
    customerId?: string | null;
    branchId?: string | null;
    orderIds?: string[];
  }): Promise<ApiResponse<CreateShipmentPreview>> =>
    apiClient
      .post<ApiResponse<CreateShipmentPreview>>(`/api/shipping/shipments/preview`, {
        sackIds: body.sackIds,
        ...(body.customerId ? { customerId: body.customerId } : {}),
        ...(body.branchId ? { branchId: body.branchId } : {}),
        ...(body.orderIds && body.orderIds.length ? { orderIds: body.orderIds } : {}),
      })
      .then((r) => r.data),

  /** Seçilen depo çuvallarından yeni sevkiyat kur (PLANNED). Müşteri ZORUNLU. */
  createShipment: (body: {
    sackIds: string[];
    customerId: string;
    branchId?: string | null;
    orderIds?: string[];
    destination?: ShipmentDestination;
    procedureCode?: string | null;
  }): Promise<ApiResponse<CreatedShipment>> =>
    apiClient
      .post<ApiResponse<CreatedShipment>>(`/api/shipping/shipments`, {
        sackIds: body.sackIds,
        customerId: body.customerId,
        ...(body.branchId ? { branchId: body.branchId } : {}),
        ...(body.orderIds && body.orderIds.length ? { orderIds: body.orderIds } : {}),
        ...(body.destination ? { destination: body.destination } : {}),
        ...(body.procedureCode ? { procedureCode: body.procedureCode } : {}),
      })
      .then((r) => r.data),
};
