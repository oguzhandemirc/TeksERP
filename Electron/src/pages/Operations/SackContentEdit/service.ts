import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  CreatedShipment,
  LocatedRoll,
  OpenOrder,
  ScanResult,
  ShipmentDestination,
  ShipmentDetail,
  ShipmentSackLean,
} from "./types";

/**
 * Paketleme / Çuval Düzelt servisi — masaüstü (Electron) paketleme istasyonu.
 * Mobil `packingService` aynası; tüm uçlar mevcut backend uçları (yeni uç YOK).
 * apiClient interceptor hata mesajını zaten toast'lar → mutation'da onError yok.
 */
export const packingService = {
  // ── Sipariş seçim ──
  /** Açık siparişler + depo karşılaması (müşteri+şube grupları). */
  listOpenOrders: (params?: {
    customerId?: string;
    branchId?: string;
  }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.branchId) q.set("branchId", params.branchId);
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<OpenOrder[]>>(`/api/shipping/open-orders${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },

  // ── Sevkiyat oturumu ──
  /** Siparişlerden yeni PREPARING sevkiyat aç (tek müşteri+şube zorunlu). */
  createShipment: (
    orderIds: string[],
    destination?: ShipmentDestination,
  ): Promise<ApiResponse<CreatedShipment>> =>
    apiClient
      .post<ApiResponse<CreatedShipment>>(`/api/shipping/shipments`, {
        orderIds,
        ...(destination ? { destination } : {}),
      })
      .then((r) => r.data),

  /** Tam sevkiyat detayı (orders + rolls[sackId] + sacks + summary). */
  getShipment: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient
      .get<ApiResponse<ShipmentDetail>>(`/api/shipping/shipments/${id}`)
      .then((r) => r.data),

  // ── Okutma / içerik ──
  /** Barkod okut → top/kartelayı sevkiyata + (verilirse) aktif çuvala ekle/taşı. */
  scan: (id: string, barcode: string, sackId?: string | null): Promise<ApiResponse<ScanResult>> =>
    apiClient
      .post<ApiResponse<ScanResult>>(`/api/shipping/shipments/${id}/scan`, {
        barcode,
        ...(sackId ? { sackId } : {}),
      })
      .then((r) => r.data),

  /** Topu sevkiyattan çıkar (depoya geri döner). */
  removeRoll: (id: string, rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/remove-roll`, { rollId })
      .then((r) => r.data),

  /** Kartelayı sevkiyattan çıkar. */
  removeSwatch: (id: string, swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/remove-swatch`, { swatchId })
      .then((r) => r.data),

  /** Topu çuvaldan çuvala taşı (aynı sevkiyat içi). */
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/rolls/${rollId}/move-sack`, { sackId })
      .then((r) => r.data),

  /** İki topun çuvalını takas et (aynı sevkiyat içi). */
  swapRollSacks: (rollAId: string, rollBId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/rolls/swap-sacks`, { rollAId, rollBId })
      .then((r) => r.data),

  // ── Çuval (aç / tart / sil) ──
  /** Boş çuval aç (PREPARING). weightKg verilirse doğrudan tartılı açılır. */
  addSack: (id: string, weightKg?: number): Promise<ApiResponse<ShipmentSackLean>> =>
    apiClient
      .post<ApiResponse<ShipmentSackLean>>(
        `/api/shipping/shipments/${id}/sacks`,
        weightKg != null ? { weightKg } : {},
      )
      .then((r) => r.data),

  /** Çuvalı tart + elle kod gir (en az biri zorunlu; içerik değişince tartı sıfırlanır). */
  weighSack: (
    sackId: string,
    body: { weightKg?: number; manualCode?: string },
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/sacks/${sackId}/weigh`, body)
      .then((r) => r.data),

  /** Çuval sil (boş) veya withContents=true → içeriği depoya döndürüp sil (PREPARING). */
  removeSack: (sackId: string, withContents?: boolean): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(
        `/api/shipping/sacks/${sackId}/remove`,
        withContents ? { withContents: true } : {},
      )
      .then((r) => r.data),

  // ── Yaşam döngüsü ──
  /** Sevke Hazır → READY (çuval depo) — karşılanma kesinleşir; invariant'ları backend doğrular. */
  markReady: (id: string): Promise<ApiResponse<{ shipmentId: string; rollCount: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; rollCount: number }>>(
        `/api/shipping/shipments/${id}/ready`,
        {},
      )
      .then((r) => r.data),

  /** Kapı Önüne Koy (PREPARING/READY → AT_DOOR). */
  moveToDoor: (id: string): Promise<ApiResponse<{ shipmentId: string }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string }>>(`/api/shipping/shipments/${id}/move-to-door`, {})
      .then((r) => r.data),

  /** Sevk çıkışı — stok düşer (terminal). */
  dispatch: (
    id: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null } = {},
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/dispatch`, data)
      .then((r) => r.data),

  /** Top yerini bul — barkod tam eşleşme (çuval + sevkiyat + statü). */
  locateRoll: (barcode: string): Promise<ApiResponse<LocatedRoll>> =>
    apiClient
      .get<ApiResponse<LocatedRoll>>(
        `/api/shipping/locate-roll?barcode=${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data),

  /**
   * Çuval koduna (sackNo veya manualCode) göre sevkiyatı bul — sevk edilmemiş
   * (PREPARING/READY/AT_DOOR) çuvalları kapsar. Birden çok eşleşirse ilki döner;
   * çağıran belirsizliği yönetir.
   */
  findShipmentIdBySackCode: (code: string): Promise<string | null> =>
    apiClient
      .get<{ data: Array<{ shipment?: { id?: string } | null }> }>(
        `/api/shipping/sack-search?sackCode=${encodeURIComponent(code)}`,
      )
      .then((r) => {
        const ids = new Set(
          (r.data.data ?? []).map((row) => row.shipment?.id).filter((x): x is string => !!x),
        );
        return ids.size === 1 ? [...ids][0]! : null;
      }),
};
