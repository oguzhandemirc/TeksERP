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

  /** İrsaliye açıklamasını oku (kayıtlı annotation not). */
  getDispatchNote: (id: string): Promise<ApiResponse<{ dispatchNote: string | null }>> =>
    apiClient
      .get<ApiResponse<{ dispatchNote: string | null }>>(`/api/shipping/shipments/${id}/dispatch-note`)
      .then((r) => r.data),

  /** İrsaliye açıklamasını kaydet — sürüm doğurmaz, her an düzenlenebilir. */
  setDispatchNote: (id: string, dispatchNote: string | null): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/dispatch-note`, { dispatchNote })
      .then((r) => r.data),

  /** Araca yüklenen gerçek çuval adedi — `null` beyanı kaldırır.
   *  Bayrak kapalıyken backend 400 döner (UI'da gizlemek tek başına yetmez). */
  setManualSackCount: (id: string, manualSackCount: number | null): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/manual-sack-count`, {
        manualSackCount,
      })
      .then((r) => r.data),

  /** Storno önizlemesi — geri dönecek çuval/top + engel varsa sebebi (`blockReason`). */
  undoDispatchPreview: (id: string): Promise<ApiResponse<UndoDispatchPreview>> =>
    apiClient
      .get<ApiResponse<UndoDispatchPreview>>(`/api/shipping/shipments/${id}/undo-dispatch-preview`)
      .then((r) => r.data),

  /**
   * Sevki geri al (DISPATCHED → PLANNED) — gerekçe zorunlu, irsaliye İPTAL edilir.
   * `releaseSacks` → storno + kapanış aynı tx: sevkiyat PLANNED'da beklemez
   * (CANCELLED), çuvallar depoya döner. Sevk onayı KAPALI rejimin olağan yolu.
   */
  undoDispatch: (id: string, reason: string, releaseSacks = false): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/undo-dispatch`, { reason, releaseSacks })
      .then((r) => r.data),
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

export interface UndoAffectedRoll {
  id: string;
  barcode: string | null;
  meters: number;
  /** Emanet sahibi (G3); null = bizim mal. */
  ownerName: string | null;
  /** Döneceği raf (`RollStatus`). */
  returnTo: string;
}

/**
 * Storno (Sevki Geri Al) önizleme yanıtı — backend getUndoDispatchPreview aynası.
 *
 * `blockReason` backend'in TEK kaynağından gelir; istemci kendi kuralını KURMAZ
 * (kopyalanan kural, ekranda "yapılabilir" derken uçta 409 üretirdi).
 */
export interface UndoDispatchPreview {
  shipmentId: string;
  shipmentNo: string;
  status: string;
  dispatchedAt: string | null;
  customerName: string;
  branchName: string | null;
  plateNumber: string | null;
  driverName: string | null;
  canUndo: boolean;
  blockReason: string | null;
  sackCount: number;
  rollCount: number;
  swatchCount: number;
  /** Yıkıcı önizleme HER kaydı listeler: çuval + içindeki toplar (barkod · metre · emanet sahibi · döneceği raf). */
  sacks: { id: string; sackNo: string; rollCount: number; rolls?: UndoAffectedRoll[] }[];
  /** Çuvalsız (doğrudan sevkiyata bağlı) toplar — bugün boş; eski sunucu alanı göndermez. */
  looseRolls?: UndoAffectedRoll[];
  affectedOrders: string[];
  voidsDispatchNote: boolean;
  /**
   * `shipping.confirmationEnabled` — "sevkiyatı da kapat" seçeneğinin VARSAYILANI
   * bundan kurulur: kapalı rejimde PLANNED beklemenin karşılığı yok → varsayılan
   * kapat; açık rejimde PLANNED doğal → varsayılan beklet.
   */
  confirmationEnabled: boolean;
  /** Topların döneceği raflar (WAREHOUSE / A1_STOCK …) — 2. kalite ayrımı görünür kalsın. */
  returnTargets: { status: string; rollCount: number }[];
}
