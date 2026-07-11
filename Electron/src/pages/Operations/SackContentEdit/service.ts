import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  AddKartelaResult,
  CustomerPool,
  KartelaStockGroup,
  LocatedRoll,
  OpenedSack,
  OpenOrder,
  ScanResult,
} from "./types";

/**
 * Paketleme servisi (Çuval Havuzu modeli) — masaüstü paketleme istasyonu.
 * Çuval müşteriye ait, sevkiyattan bağımsız: aç → okut → tart/kod → mühürle → havuza girer.
 * apiClient interceptor hata mesajını zaten toast'lar → mutation'da onError yok.
 */
export const packingService = {
  /** Açık siparişler + depo karşılaması (paketleme rehberi). */
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.branchId) q.set("branchId", params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/api/shipping/open-orders${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },

  /** Müşterinin havuz çuvalları (açık + mühürlü) + içerik — paketleme workspace kaynağı. */
  listCustomerPool: (customerId: string): Promise<ApiResponse<CustomerPool>> =>
    apiClient
      .get<ApiResponse<CustomerPool>>(`/api/shipping/pool/sacks?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.data),

  /** Müşteriye yeni (açık) havuz çuvalı aç. */
  openSack: (customerId: string, branchId?: string | null): Promise<ApiResponse<OpenedSack>> =>
    apiClient
      .post<ApiResponse<OpenedSack>>(`/api/shipping/sacks`, { customerId, ...(branchId ? { branchId } : {}) })
      .then((r) => r.data),

  /** Barkod okut → top/kartelayı açık çuvala ekle/taşı. */
  scanIntoSack: (sackId: string, barcode: string): Promise<ApiResponse<ScanResult>> =>
    apiClient.post<ApiResponse<ScanResult>>(`/api/shipping/sacks/${sackId}/scan`, { barcode }).then((r) => r.data),

  /** Çuvalı tart + elle kod gir (en az biri). */
  weighSack: (sackId: string, body: { weightKg?: number; manualCode?: string }): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/sacks/${sackId}/weigh`, body).then((r) => r.data),

  /** Çuvalı mühürle → çuval depo havuzuna girer. */
  sealSack: (sackId: string): Promise<ApiResponse<{ sackId: string }>> =>
    apiClient.post<ApiResponse<{ sackId: string }>>(`/api/shipping/sacks/${sackId}/seal`, {}).then((r) => r.data),

  /** Mührü aç — içerik düzeltmek için. */
  reopenSack: (sackId: string): Promise<ApiResponse<{ sackId: string }>> =>
    apiClient.post<ApiResponse<{ sackId: string }>>(`/api/shipping/sacks/${sackId}/reopen`, {}).then((r) => r.data),

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

  /** Topu başka çuvala taşı (aynı müşteri, açık çuvallar). */
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/shipping/rolls/${rollId}/move-sack`, { sackId }).then((r) => r.data),

  /** Kartela stoğu (ürün+renk bazında müsait adet). */
  listKartelaStock: (search?: string): Promise<ApiResponse<KartelaStockGroup[]>> =>
    apiClient
      .get<ApiResponse<KartelaStockGroup[]>>(`/api/kartela/stock${search ? `?search=${encodeURIComponent(search)}` : ""}`)
      .then((r) => r.data),

  /** Seçerek kartela ekle (barkodsuz) — açık çuvala N adet. */
  addKartela: (sackId: string, body: { itemId: string; colorId: string | null; count: number }): Promise<ApiResponse<AddKartelaResult>> =>
    apiClient.post<ApiResponse<AddKartelaResult>>(`/api/shipping/sacks/${sackId}/add-kartela`, body).then((r) => r.data),

  /** Top yerini bul — barkod tam eşleşme. */
  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(`/api/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),
};
