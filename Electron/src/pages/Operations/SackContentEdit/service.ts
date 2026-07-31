import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import { buildCursorQueryString } from "@/lib/query-builder";
import type {
  AddKartelaResult,
  CreatedShipment,
  CreateShipmentPreview,
  KartelaStockGroup,
  LocatedRoll,
  OpenedSack,
  OpenOrder,
  PickListRow,
  SackContentDumpSack,
  SackContents,
  SackSearchRow,
  ScanResult,
  ShipmentDestination,
} from "./types";

/** Çuval müşteri değiştirme yanıtı — çözülmüş ad/kod (editör rozeti fetch'siz güncellenir). */
export interface ReassignResult {
  id: string;
  customerId: string | null;
  customerName: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  /**
   * Müşteri değişimi yüzünden etiketi bayatlayan (labelDirty işaretlenen) top adedi.
   * YALNIZ yeni/eski müşterinin ETİKET ŞABLONU (CustomerTemplateRoute) farklıysa > 0 —
   * etikete müşteri adı basılmadığı için müşteri değişimi tek başına etiketi
   * geçersiz kılmaz.
   */
  labelsStale?: number;
}

/**
 * Çuval Deposu / Paketleme hub servisi — backend /api/shipping (Çuval Depo modeli).
 * Tek geçit: arama (cursor) + çuval içerik düzenleme (aç/okut/tart/çıkar/taşı/sil) +
 * havuzdan sevkiyat kurma (önizleme + oluştur). Mühür/seal ve packedQty YOK.
 * apiClient interceptor hata mesajını zaten toast'lar → mutation'da onError yok.
 */
export const sackHubService = {
  // ── Liste (DataTable cursor fetcher) ───────────────────────────────────────
  /**
   * `useDataTable` fetcher — standart cursor query (`filter[itemId|colorId|
   * customerId|scope|widthMin|widthMax]` + `search` + `sortBy/sortOrder` +
   * `withTotal` + `cursor/limit`). Backend `/sack-search` bu sözleşmeyi karşılar.
   */
  listSacks: (params: CursorParams): Promise<CursorPaginatedResponse<SackSearchRow>> =>
    apiClient
      .get<CursorPaginatedResponse<SackSearchRow>>(`/api/shipping/sack-search${buildCursorQueryString(params)}`)
      .then((r) => r.data),

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

  /**
   * İçerik dökümü — seçilen çuvalların TOP BAZLI dökümü. Çeki listesinden farkı:
   * orası ürün·renk·en bazında GRUPLU özet döner, bu uç her topu ayrı satır verir
   * (barkod dahil). Excel/PDF/yazdır içerik dökümünün kaynağı.
   */
  contentDump: (sackIds: string[]): Promise<ApiResponse<SackContentDumpSack[]>> =>
    apiClient
      .post<ApiResponse<SackContentDumpSack[]>>(`/api/shipping/sack-search/content-dump`, { sackIds })
      .then((r) => r.data),

  // ── Sipariş rehberi + müşteri havuzu ───────────────────────────────────────
  /** Açık siparişler + depo karşılaması (sevkiyat sipariş seçimi rehberi). */
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set("customerId", params.customerId);
    if (params?.branchId) q.set("branchId", params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/api/shipping/open-orders${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },

  // ── Çuval içerik düzenleme (depodaki çuval — her zaman düzenlenebilir) ──────
  /** Yeni depo çuvalı aç — müşteri/şube OPSİYONEL (müşterisiz genel stok da olur).
   *  clientToken: deneme başına bir kez üretilir; retry aynı token'la → backend
   *  mükerrer boş çuval yerine ilk açılanı döner (idempotent replay, A4). */
  openSack: (body: { customerId?: string | null; branchId?: string | null; clientToken?: string }): Promise<ApiResponse<OpenedSack>> =>
    apiClient
      .post<ApiResponse<OpenedSack>>(`/api/shipping/sacks`, {
        ...(body.customerId ? { customerId: body.customerId } : {}),
        ...(body.branchId ? { branchId: body.branchId } : {}),
        ...(body.clientToken ? { clientToken: body.clientToken } : {}),
      })
      .then((r) => r.data),

  /** Barkod okut → top/kartelayı çuvala ekle/taşı. */
  scanIntoSack: (sackId: string, barcode: string): Promise<ApiResponse<ScanResult>> =>
    apiClient.post<ApiResponse<ScanResult>>(`/api/shipping/sacks/${sackId}/scan`, { barcode }).then((r) => r.data),

  /**
   * Çuvalı tart (brüt kg). `source` = tartının KAYNAĞI; backend simüle kantar
   * korumasının girdisi (`shipping.simulatedWeightEnabled` kapalıyken SIMULATED → 400).
   * Verilmezse backend MANUAL varsayar (geri uyum) — elle giriş yolu bunu kullanır.
   */
  weighSack: (
    sackId: string,
    weightKg: number,
    source?: "SCALE" | "MANUAL" | "SIMULATED",
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/sacks/${sackId}/weigh`, {
        weightKg,
        ...(source ? { source } : {}),
      })
      .then((r) => r.data),

  /**
   * Çuvalı böl — seçili topları YENİ çuvala ayır. Backend ATOMİK (tek tx: çuval aç
   * + taşı + iki çuvalın tartısını sıfırla); istemcide openSack+move iki-çağrısı
   * yapılmaz, yarım kalırsa ortada boş çuval kalırdı. Kaynakta en az bir top kalmalı.
   */
  splitSack: (
    sackId: string,
    rollIds: string[],
  ): Promise<ApiResponse<{ sackId: string; sackNo: string; moved: number }>> =>
    apiClient
      .post<ApiResponse<{ sackId: string; sackNo: string; moved: number }>>(
        `/api/shipping/sacks/${sackId}/split`,
        { rollIds },
      )
      .then((r) => r.data),

  /** Çuval notunu oku (tam metin). */
  getSackNotes: (sackId: string): Promise<ApiResponse<{ notes: string | null }>> =>
    apiClient.get<ApiResponse<{ notes: string | null }>>(`/api/shipping/sacks/${sackId}/notes`).then((r) => r.data),

  /**
   * Çuval notunu yaz/temizle — iç serbest not. Çuvalın DURUMU fark etmez:
   * sevkiyata atanmış veya sevk edilmiş çuvala da yazılır (annotation, sürüm doğurmaz).
   */
  setSackNotes: (sackId: string, notes: string | null): Promise<ApiResponse<{ sackId: string; notes: string | null }>> =>
    apiClient
      .post<ApiResponse<{ sackId: string; notes: string | null }>>(`/api/shipping/sacks/${sackId}/notes`, { notes })
      .then((r) => r.data),

  /** Depodaki çuvalın müşterisini/şubesini değiştir (sevkiyata girmemiş çuval; null=müşterisiz).
   *  Yanıt çözülmüş ad/kodu döner → istemci editör rozetini fetch'siz günceller. */
  reassignCustomer: (
    sackId: string,
    body: { customerId: string | null; branchId: string | null },
  ): Promise<ApiResponse<ReassignResult>> =>
    apiClient
      .post<ApiResponse<ReassignResult>>(`/api/shipping/sacks/${sackId}/customer`, {
        customerId: body.customerId,
        branchId: body.branchId,
      })
      .then((r) => r.data),

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

  /** Çuvalı dağıt — seçili (rollIds) veya (boş gövde) TÜM içeriği serbest depoya çıkar. */
  distributeSack: (
    sackId: string,
    body?: { rollIds?: string[]; swatchIds?: string[] },
  ): Promise<ApiResponse<{ removedRolls: number; removedSwatches: number }>> =>
    apiClient
      .post<ApiResponse<{ removedRolls: number; removedSwatches: number }>>(`/api/shipping/sacks/${sackId}/distribute`, {
        ...(body?.rollIds?.length ? { rollIds: body.rollIds } : {}),
        ...(body?.swatchIds?.length ? { swatchIds: body.swatchIds } : {}),
      })
      .then((r) => r.data),

  /** Seçili topları başka depo çuvalına TOPLU taşı. */
  moveRollsToSack: (sackId: string, rollIds: string[], targetSackId: string): Promise<ApiResponse<{ moved: number }>> =>
    apiClient
      .post<ApiResponse<{ moved: number }>>(`/api/shipping/sacks/${sackId}/move-rolls`, { rollIds, targetSackId })
      .then((r) => r.data),

  /** Kartela stoğu (kumaş+renk bazında müsait adet). */
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
    /** İdempotency — deneme başına bir üretilir, retry aynı token'la (backend replay, A4). */
    clientToken?: string;
  }): Promise<ApiResponse<CreatedShipment>> =>
    apiClient
      .post<ApiResponse<CreatedShipment>>(`/api/shipping/shipments`, {
        sackIds: body.sackIds,
        customerId: body.customerId,
        ...(body.branchId ? { branchId: body.branchId } : {}),
        ...(body.orderIds && body.orderIds.length ? { orderIds: body.orderIds } : {}),
        ...(body.destination ? { destination: body.destination } : {}),
        ...(body.procedureCode ? { procedureCode: body.procedureCode } : {}),
        ...(body.clientToken ? { clientToken: body.clientToken } : {}),
      })
      .then((r) => r.data),
};
