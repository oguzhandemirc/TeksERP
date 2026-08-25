import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type {
  Roll,
  OpenFabricCreateRequest,
  KursunFinishRequest,
} from '../types/models';

export interface RollStats {
  totalCount: number;
  /** Filtreye uyan tüm rolların `currentQty` toplamı — metre. */
  totalQty: number;
  /** `weightKg` toplamı (null'lar atlanır) — kg. */
  totalWeight: number;
  /** RollStatus → adet. Eşleşmeyen status hiç yer almaz. */
  byStatus: Record<string, number>;
  /** Kalite kodu → adet (A1, FIRE, 1.KALITE …). */
  byQuality: Record<string, number>;
}

/** Backend `GET /rolls/:id/cancel-preview` cevabı (inventory.service ile aynı). */
export interface RollCancelPreview {
  rollId: string;
  barcode: string | null;
  status: string;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  /** Hard-block yoksa true. */
  canCancel: boolean;
  /** canCancel=false ise neden (Türkçe). */
  blockReason: string | null;
  /** İstasyonda/iş emrinde aktif → iptal için confirmActive şart. */
  requiresConfirm: boolean;
  activeAt: {
    stepId: string;
    stationName: string | null;
    stationKind: string | null;
    workOrderId: string;
    batchNumber: string | null;
  } | null;
  openMovementCount: number;
  /**
   * Topun ÜSTÜNDE fiziksel etiket var mı. true ise iptal AYRI bir onay + SEBEP
   * ister: kayıt ölür ama kâğıt topun üstünde kalır ("ölü etiket"), sonraki
   * okutma yalnız "stokta değil" der ve kimse sebebini bilmez.
   * `requiresConfirm`'den AYRI eksen — biri "mal istasyonda mı", diğeri
   * "sahaya geçersiz kimlik bırakıyor muyum". İkisi birden çıkabilir.
   */
  labelPrinted: boolean;
  /** Etiketin basıldığı an (ISO) — "10:48'de bastınız" diyebilmek için. */
  labelPrintedAt: string | null;
}

export interface RollCursorPage {
  success: boolean;
  data: Roll[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface CursorListParams {
  limit?: number;
  cursor?: string | null;
  search?: string;
  filters?: Record<string, string | string[]>;
  /** Backend `?withTotal=true` — ilk sayfada total döndürmek için. */
  withTotal?: boolean;
  /**
   * Tarih aralığı (top listesi filtresi). ⚠️ `dateField` GÖNDERİLMEK ZORUNDA:
   * backend `applyDateRange` alan adı yoksa aralığı SESSİZCE yok sayar
   * (`if (!params.dateField) return`) — filtre seçili görünür, liste süzülmez.
   * İzinli alan: `createdAt` (`ROLL_DATE_FIELDS`).
   */
  dateField?: string;
  /** ISO — mutlak an. Gün sınırını istemci çözer (Electron ile aynı sözleşme). */
  dateFrom?: string;
  dateTo?: string;
}

function buildCursorQueryString(params: CursorListParams): string {
  const sp = new URLSearchParams();
  sp.set('mode', 'cursor');
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.search) sp.set('search', params.search);
  if (params.withTotal) sp.set('withTotal', 'true');
  // Tarih üçlüsü: alan adı olmadan aralık backend'de sessizce düşer.
  if (params.dateField && (params.dateFrom || params.dateTo)) {
    sp.set('dateField', params.dateField);
    if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
    if (params.dateTo) sp.set('dateTo', params.dateTo);
  }
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (!v || (Array.isArray(v) && v.length === 0)) continue;
      const val = Array.isArray(v) ? v.join(',') : v;
      if (val) sp.set(`filter[${k}]`, val);
    }
  }
  return `?${sp.toString()}`;
}

export interface InitialEntryRequest {
  itemId: string;
  /** Ham mal genelde NULL — boyahanede kazanır. Opsiyonel renk override. */
  colorId?: string | null;
  initialQty: number;
  weightKg?: number;
  qualityGrade?: string;
  width?: number;
  /**
   * Opsiyonel idempotency anahtarı (UUID) — offline KK1 / ağ-retry için. Barkod
   * artık SUNUCU'da sıralı atanır (TEKS+YYMMDD+H/F+A001..); aynı token'la 2. çağrı
   * cached Roll döner (mükerrer top önlenir). Etiket sunucudan dönen barkodla basılır.
   */
  clientToken?: string;
  /**
   * Backend mükerrer tuzağı (`kk1.duplicateGuardEnabled`, varsayılan KAPALI)
   * 409 POSSIBLE_DUPLICATE döndükten sonra operatörün açık onayı: "evet, bu
   * gerçekten ayrı bir top". Tuzak ENGELLEMEZ, ONAYLATIR — aynı partiden
   * birebir eşit metrajlı toplar arka arkaya meşru olarak girilebilir.
   */
  confirmDuplicate?: boolean;
  /**
   * DIŞARIDAN ALINAN YARI MAMÜL (2026-08-17). Backend `entrySource=SEMI_FINISHED`
   * yazar VE statü sezgisini bypass eder (renkli top normalde BİTMİŞ DEPO'ya
   * düşerdi; yarı mamül ham stokta kalıp kurşun/tambur görecek). `mobile:kk1-yari-mamul`
   * yetkisi ister; renk ZORUNLU.
   */
  semiFinished?: boolean;
  /**
   * Operatörün "Kaydet"e BASTIĞI an (ISO-8601, UTC). Backend mükerrer tuzağının
   * 90 sn'lik penceresini SUNUCU SAATİYLE DEĞİL bununla ölçer.
   *
   * NEDEN: offline kuyruk tek flush'ta boşalır → çevrimdışı 40 dakikaya yayılmış
   * 5 giriş sunucuda milisaniyelerle ayrılır. Sunucu saatiyle ölçülen pencere bu
   * yüzden her flush'ta doludur ve "aynı partiden eşit metrajlı toplar" (tekstilde
   * olağan) yanlış POZİTİF alırdı; tersi de mümkündür (3 sn arayla girilip ayrı
   * ayrı flush olanlar dakikalarca ayrı görünür → yanlış NEGATİF). Damga operatörün
   * gerçek ritmini taşır.
   *
   * ⚠️ YAŞAM DÖNGÜSÜ `clientToken` İLE AYNIDIR (`offline/entryAttempt`
   * → `freshEntryIdentity`): birlikte doğar, birlikte yolculuk eder. **Retry ve
   * uçuş tekrarı TAZELEMEZ** — tazelenirse pencere kayar ve koruma tam da en çok
   * gerektiği anda kapanır.
   *
   * Eski backend'e gönderilirse Zod'un düz `z.object`'i alanı SESSİZCE atar
   * (400 YOK) — yani APK, backend'den önce de sahaya çıkabilir.
   */
  clientEnteredAt?: string;
}

export const rollService = {
  createInitialEntry: (data: InitialEntryRequest): Promise<ApiResponse<Roll>> =>
    apiClient.post<ApiResponse<Roll>>('/rolls/initial-entry', data).then((r) => r.data),

  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient.get<ApiResponse<Roll>>(`/rolls/barcode/${barcode}`).then((r) => r.data),

  /**
   * Soft delete — top CANCELLED işaretlenir. Açık movement'lar kapatılır,
   * currentStep temizlenir. SHIPPED / AT_SUBCONTRACTOR / açık sevki olan toplar
   * reddedilir. Bir istasyonda/iş emrinde AKTİF top (currentStep/açık movement)
   * için backend `confirmActive=true` ŞART — önce getCancelPreview ile operatöre
   * gösterilir, onaylanırsa confirmActive geçilir.
   */
  /**
   * ⚠️ ADI `scrap` AMA YAPTIĞI İŞ İPTAL (`DELETE /rolls/:id` → CANCELLED).
   * 2026-08-25'te GERÇEK bir fire ucu doğdu (`POST /rolls/:id/scrap` → SCRAP,
   * "mal vardı, artık yok") ve bu ad artık aktif olarak yanıltıcı. Ad korunuyor
   * çünkü çevrimdışı KUYRUKTA bu anahtarla bekleyen kayıtlar olabilir; yeni
   * çağrı yazarken `cancel` takma adını kullan.
   */
  scrap: (
    id: string,
    confirmActive = false,
    /**
     * ⚠️ `confirmLabelPrinted` ARTIK BİR KAPI DEĞİL (2026-08-25): ölü etiket
     * guard'ı backend'den kaldırıldı. Gönderilmeye devam ediyor (zararsız,
     * sözleşme uyumu) ama artık hiçbir şeyi açmıyor — "göndermezsem reddedilir"
     * varsayımıyla yeni kod YAZMA.
     */
    labelOpts?: { confirmLabelPrinted?: boolean; reason?: string },
  ): Promise<ApiResponse<Roll>> => {
    const qs = new URLSearchParams();
    if (confirmActive) qs.set('confirmActive', 'true');
    if (labelOpts?.confirmLabelPrinted) qs.set('confirmLabelPrinted', 'true');
    if (labelOpts?.reason) qs.set('reason', labelOpts.reason);
    const q = qs.toString();
    return apiClient
      .delete<ApiResponse<Roll>>(`/rolls/${id}${q ? `?${q}` : ''}`)
      .then((r) => r.data);
  },

  /**
   * İptali GERİ AL — `CANCELLED` → iptalden önceki raf.
   *
   * Var olma sebebi: geri dönüş yolu olmayınca operatörün tek çaresi topu
   * YENİDEN GİRMEK olur ve o, aynı fiziksel top için ikinci bir barkod doğurur
   * (2026-08-05: T050826H0033 öldü → T050826H0072 doğdu → topta iki etiket).
   * Kapsam dar; engelliyse backend somut Türkçe sebep döner (`RESTORE_BLOCKED`).
   */
  restoreCancel: (id: string, reason?: string): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>(`/rolls/${id}/restore-cancel`, reason ? { reason } : {})
      .then((r) => r.data),

  /** İptal önizlemesi — silmeden önce somut etki (hangi istasyon/iş emri). */
  getCancelPreview: (id: string): Promise<ApiResponse<RollCancelPreview>> =>
    apiClient
      .get<ApiResponse<RollCancelPreview>>(`/rolls/${id}/cancel-preview`)
      .then((r) => r.data),

  /**
   * Saha #4: top etiketini değiştir (renk/özellik/en/kalite). Yalnız serbest
   * stok/depo veya PLANNED sevkiyattaki top; DISPATCHED sevkiyatta 409.
   */
  relabel: (
    id: string,
    data: { colorId?: string | null; propertyIds?: string[]; width?: number | null; qualityGrade?: string },
  ): Promise<ApiResponse<unknown>> =>
    apiClient.patch<ApiResponse<unknown>>(`/rolls/${id}/label`, data).then((r) => r.data),

  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Roll>> =>
    apiClient.get<PaginatedResponse<Roll>>(`/rolls${buildQueryString(params)}`).then((r) => r.data),

  /** Cursor-pagination liste — infinite scroll için. */
  getAllCursor: (params: CursorListParams): Promise<RollCursorPage> =>
    apiClient.get<RollCursorPage>(`/rolls${buildCursorQueryString(params)}`).then((r) => r.data),

  /** "Personel" filtre seçenekleri — yalnız en az bir top girmiş kullanıcılar.
   *  (Kullanıcı kataloğu DEĞİL: o uç admin:users ister, bu MOBILE_ROLL_READ.) */
  getEntryUsers: (): Promise<{ success: boolean; data: { id: string; name: string; code: string | null }[] }> =>
    apiClient
      .get<{ success: boolean; data: { id: string; name: string; code: string | null }[] }>('/rolls/entry-users')
      .then((r) => r.data),

  /** "Giriş İstasyonu" filtre seçenekleri — giriş istasyonu olmuş istasyonlar. */
  getEntryStations: (): Promise<{ success: boolean; data: { id: string; name: string; code: string | null }[] }> =>
    apiClient
      .get<{ success: boolean; data: { id: string; name: string; code: string | null }[] }>('/rolls/entry-stations')
      .then((r) => r.data),

  /**
   * Liste ile aynı filtre setini paylaşan TÜM-DB özeti.
   * Sayfa toplamı değil; gerçek aggregate.
   */
  getStats: (params: {
    search?: string;
    filters?: Record<string, string | string[]>;
  }): Promise<ApiResponse<RollStats>> => {
    const sp = new URLSearchParams();
    if (params.search) sp.set('search', params.search);
    if (params.filters) {
      for (const [k, v] of Object.entries(params.filters)) {
        if (!v || (Array.isArray(v) && v.length === 0)) continue;
        const val = Array.isArray(v) ? v.join(',') : v;
        if (val) sp.set(`filter[${k}]`, val);
      }
    }
    const qs = sp.toString();
    return apiClient
      .get<ApiResponse<RollStats>>(`/rolls/stats${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  // Depo kapsam sayaçları (çuval havuzu modeli) — serbest (sackId=null) / çuval depo
  // havuzu (pool: sackId dolu, sevkiyatsız) / planlı sevkiyat (PLANNED).
  getWarehouseScope: (): Promise<
    ApiResponse<{
      free: { count: number; qty: number };
      pool: { count: number; qty: number };
      planned: { count: number; qty: number };
    }>
  > => apiClient.get(`/rolls/warehouse-scope`).then((r) => r.data),

  getHistory: (
    rollId: string
  ): Promise<
    ApiResponse<{
      events: Array<{
        kind: string;
        title: string;
        at: string;
        stationName: string | null;
        operatorName: string | null;
        details?: Record<string, unknown>;
      }>;
    }>
  > =>
    apiClient
      .get<
        ApiResponse<{
          events: Array<{
            kind: string;
            title: string;
            at: string;
            stationName: string | null;
            operatorName: string | null;
            details?: Record<string, unknown>;
          }>;
        }>
      >(`/rolls/${rollId}/history`)
      .then((r) => r.data),

  /**
   * Boyahane dönüşü Kurşun/KK2'de yeni açık kumaş Roll oluştur. Barkod basılmaz;
   * colorId/properties receipt'ten inherit edilir.
   */
  createOpenFabric: (data: OpenFabricCreateRequest): Promise<ApiResponse<Roll>> =>
    apiClient.post<ApiResponse<Roll>>('/rolls/open-fabric', data).then((r) => r.data),

  /**
   * Açık kumaş Kurşun/KK2 kapanışı — totalMeters + hata noktaları. Roll Tambur
   * step'ine ilerletilir. Tekrar çağırma 409 atar.
   */
  kursunFinish: (
    rollId: string,
    data: KursunFinishRequest
  ): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>(`/rolls/${rollId}/kursun-finish`, data)
      .then((r) => r.data),
};
