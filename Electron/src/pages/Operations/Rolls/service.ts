import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type {
  ApiResponse,
  CursorPaginatedResponse,
  CursorParams,
  PaginatedResponse,
  QueryParams,
} from "@/types/api";
import { buildCursorQueryString, buildQueryString } from "@/lib/query-builder";
import type { Roll } from "./types";

/**
 * Top yaşam döngüsü sekmeleri — backend `filter[status]` CSV olarak alır,
 * `buildWhereClause` virgülü `{ in: [...] }`'a çevirir. Sekme her zaman
 * forceFilters üzerinden gönderilir; `withDefault*` artık gerekmiyor.
 *
 * Station-bazlı sekmeler (`KURSUN_PENDING` ve `TAMBUR_PENDING`) status
 * filtrelemez — sırasıyla `currentStepKind=PROCESS_QC` (KK2/Kurşun) ve
 * `currentStepKind=TAMBUR` filtresi uygulanır (`buildRollForceFilters` içinde).
 * İstasyonda sıra bekleyen açık kumaş VE barkodlu toplar birlikte listelenir
 * (rollKind=OPEN_FABRIC filtresi 2026-07-27'de kaldırıldı — barkodlu top da
 * istasyonda meşru bekler).
 */
/**
 * Sekme → backend filter. Null değerli sekmeler `status` filter göndermez,
 * `buildRollForceFilters` üzerinden farklı parametre (rollScope,
 * currentStepKind, rollKind) ile çalışır.
 *
 * Eski "STOCK" sekmesi iki ayrı sekmeye bölündü:
 *   - RAW_STOCK: KK1 ham, henüz üretime girmemiş (rollScope=RAW_STOCK)
 *   - FINISHED_STOCK: Tambur sonrası depoda (rollScope=FINISHED_STOCK)
 * "PRODUCTION" sekmesi super-set: tüm WO akışındaki toplar (Fasonda + Kurşun
 * Bekleyen + Tambur Bekleyen + IN_PRODUCTION). Diğer sekmeler alt-küme.
 */
const STATUS_GROUPS = {
  RAW_STOCK: null,
  // Yarı Mamul (2026-08-26): rollScope=SEMI_FINISHED ile çalışır, statü göndermez.
  SEMI_FINISHED: null,
  PRODUCTION: null,
  SUBCONTRACTOR: "AT_SUBCONTRACTOR",
  KURSUN_PENDING: null,
  TAMBUR_PENDING: null,
  FINISHED_STOCK: null,
  // Çuvalda: bir çuvala konmuş, henüz sevk edilmemiş toplar (rollScope=IN_SACK).
  IN_SACK: null,
  // Sanal anahtar — tepe-sekme DEĞİL; Kartela sayfasının "Kartelada Toplar"
  // sekmesi bunu kullanır (status=AT_KARTELA). SUBCONTRACTOR ile aynı mekanizma.
  KARTELA_SENT: "AT_KARTELA",
  // ⚠️ `CANCELLED` + `SCRAP` 2026-08-25'te EKLENDİ. Öncesinde iptal edilen ya da
  // fire edilen bir top HİÇBİR yüzeyde görünmüyordu: envanter sekmelerinin hiçbiri
  // ölü statüleri listelemez ve arşiv de yalnız dört "tüketilmiş" statüyü
  // taşıyordu. Yani "soft delete — kayıt denetim için korunur" sözü tutuluyordu
  // ama korunan kayda ULAŞMANIN YOLU YOKTU (saha bulgusu: "iptal ettim, arşivde
  // göremiyorum"). Barkodla aramak da çare değildi — iptal edilen topların bir
  // kısmı barkodsuz açık kumaştır.
  ARCHIVE:
    "RETURNED_FROM_SUBCONTRACTOR,TAMBUR_CONSUMED,SUBCONTRACTOR_CONSUMED,KARTELA_CONSUMED,CANCELLED,SCRAP",
} as const;

const base = createCrudService<Roll>("/api/rolls");

export interface InitialEntryPayload {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  weightKg?: number;
  qualityGrade?: string;
  width?: number | null;
  propertyIds?: string[];
  /** İdempotency anahtarı — timeout sonrası tekrar denemede mükerrer (hayalet)
   *  top yaratılmasını önler (backend Roll.clientToken @unique; mobil KK1 emsali). */
  clientToken?: string;
  /** Backend mükerrer tuzağı 409 POSSIBLE_DUPLICATE döndükten sonra kullanıcının
   *  açık onayı ("evet, bu gerçekten ayrı bir top"). Tuzak `kk1.duplicateGuardEnabled`
   *  ile açılır (varsayılan kapalı). */
  confirmDuplicate?: boolean;
  /** Dışarıdan alınan YARI MAMUL (2026-08-17): backend `entrySource=SEMI_FINISHED`
   *  yazar VE statü sezgisini bypass edip topu Ham Stok'a düşürür (renkli olduğu
   *  için aksi halde Bitmiş Depo'ya giderdi). */
  semiFinished?: boolean;
  /** G3 emanet: topun SAHİBİ olan müşteri (müşterinin işlenmek üzere bıraktığı kumaş). Yalnız emanet modülü
   *  açıkken gönderilir; etiket müşterisinden (`customerId` → printCtx) AYRI alan. Doğum niteliği. */
  ownerCustomerId?: string | null;
}

export interface RollStats {
  totalCount: number;
  totalQty: number;
  totalWeight: number;
  byStatus: Record<string, number>;
  byQuality: Record<string, number>;
}

// --- Fasonda özet şeridi (Envanter → Fasonda sekmesi) -----------------------
/** İşlem-tipi chip'i — kategori bazında top adedi + Σmetre. Kategorisiz sevkler
 *  (adımda requiredCategory yok) categoryId:null + name:"Bilinmiyor" kovasında
 *  toplanır → chip DISABLED (filtrelenemez). */
export interface FasonSummaryCategory {
  categoryId: string | null;
  name: string;
  rollCount: number;
  totalQty: number;
}

/** Firma kartı — firmadaki top adedi + Σmetre + en eski aktif sevkin yaşı.
 *  subcontractorId:null → açık sevk kalemi bulunamayan AT_SUBCONTRACTOR top
 *  (veri anomalisi) = "Bilinmiyor" kartı, DISABLED (filtrelenemez). */
export interface FasonSummaryFirm {
  subcontractorId: string | null;
  name: string;
  code: string | null;
  rollCount: number;
  totalQty: number;
  /** En eski açık sevkin tarihi (ISO) — null yalnız "Bilinmiyor" grubunda. */
  oldestDispatchedAt: string | null;
  /** En eski açık sevkin yaşı (gün, backend floor). Frontend BUNU basar,
   *  yeniden HESAPLAMAZ; null iken "en eski N gün" satırı gizlenir. */
  oldestDays: number | null;
}

export interface FasonSummary {
  total: { rollCount: number; totalQty: number };
  byCategory: FasonSummaryCategory[];
  bySubcontractor: FasonSummaryFirm[];
}

// --- Üretim Akışı (Kanban) — tek-istek pano cevabı ------------------------
/** Kurşun/Tambur kolonu kartı (adım = bir WO'nun kuyruğu). */
export interface ProductionFlowQueueCard {
  id: string;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  /** İş emri no (İE…) — eski `batchNumber` alanı parti-redesign köprüsüydü. */
  workOrderNumber: string;
  isUrgent: boolean;
}

/** Sevk kolonu kartı — çıkış bekleyen (PLANNED) planlı sevk. */
export interface ProductionFlowSackCard {
  id: string;
  shipmentNo: string;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalQty: number;
}

/** 7 kolon; her biri ≤10 önizleme kaydı + gerçek toplam sayaç. */
export interface ProductionFlowData {
  hamStok: { rolls: Roll[]; total: number };
  /** Dışarıdan alınan yarı mamul — ham stokla aynı rafta, farklı stok türü. */
  yariMamul: { rolls: Roll[]; total: number };
  fason: { rolls: Roll[]; total: number };
  kursun: { cards: ProductionFlowQueueCard[]; total: number };
  tambur: { cards: ProductionFlowQueueCard[]; total: number };
  depo: { rolls: Roll[]; total: number };
  sevk: { shipments: ProductionFlowSackCard[]; total: number };
}

/** Tek bir yasam dongusu olayi — backend RollHistoryEvent ile birebir. */
export interface RollHistoryEvent {
  kind: string;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: { id: string; barcode: string | null; status: string };
  events: RollHistoryEvent[];
}

export const rollService = {
  ...base,
  getAll: (params: QueryParams): Promise<PaginatedResponse<Roll>> =>
    apiClient
      .get<PaginatedResponse<Roll>>(`/api/rolls${buildQueryString(params)}`)
      .then((r) => r.data),
  listCursor: (params: CursorParams): Promise<CursorPaginatedResponse<Roll>> =>
    apiClient
      .get<CursorPaginatedResponse<Roll>>(`/api/rolls${buildCursorQueryString(params)}`)
      .then((r) => r.data),
  getStats: (params: QueryParams): Promise<ApiResponse<RollStats>> =>
    apiClient
      .get<ApiResponse<RollStats>>(`/api/rolls/stats${buildQueryString(params)}`)
      .then((r) => r.data),
  /** Envanter özeti — N kategori filtresi için toplu sayım (top + metre) TEK istekte. */
  getStatsBatch: (
    items: Array<{ key: string; filters: Record<string, string | string[]> }>,
  ): Promise<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>> =>
    apiClient
      .post<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>>(
        "/api/rolls/stats-batch",
        { items },
      )
      .then((r) => r.data),
  /** Üretim Akışı (Kanban) panosu — 6 kolon tek istekte (kolon başına ≤10 + toplam). */
  getProductionFlow: (): Promise<ApiResponse<ProductionFlowData>> =>
    apiClient
      .get<ApiResponse<ProductionFlowData>>("/api/rolls/production-flow")
      .then((r) => r.data),
  /** Fasonda özet şeridi — işlem chip'leri + firma kartları TEK istekte.
   *  Evren: AT_SUBCONTRACTOR; includeFire=true iken FIRE toplar da dahil
   *  ("Fire kaliteyi de göster" toggle'ıyla hizalı — şerit/tablo sayıları tutar). */
  getSubcontractorSummary: (includeFire = false): Promise<ApiResponse<FasonSummary>> =>
    apiClient
      .get<ApiResponse<FasonSummary>>(
        `/api/rolls/subcontractor-summary${includeFire ? "?filter[includeFire]=true" : ""}`,
      )
      .then((r) => r.data),
  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient
      .get<ApiResponse<Roll>>(`/api/rolls/barcode/${encodeURIComponent(barcode)}`)
      .then((r) => r.data),
  /**
   * Topun TAM YASAM DONGUSU — olusturuldu, istasyon giris/cikislari, fason
   * sevk/kabul, kesim soyagaci, depo. Detay panelindeki operations dizisinden
   * FARKLIDIR: o dizi RollOperation tablosudur ve yalniz 5 istasyon olayi
   * tasir; bu uc movement + operation + fason + dogum + soyagacini BIRLESTIRIR.
   * Depo/ham stok/elle eklenen topta operations tanim geregi bostur, bu uc
   * dolu doner — panelin yillardir bos gorunmesinin sebebi buydu.
   */
  getHistory: (id: string): Promise<ApiResponse<RollHistoryPayload | null>> =>
    apiClient
      .get<ApiResponse<RollHistoryPayload | null>>(`/api/rolls/${id}/history`)
      .then((r) => r.data),
  createInitialEntry: (payload: InitialEntryPayload): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>("/api/rolls/initial-entry", payload)
      .then((r) => r.data),

  /**
   * İptali GERİ AL — `CANCELLED` → iptalden önceki raf.
   *
   * Var olma sebebi (2026-08-05 saha vakası): geri dönüş yolu olmadığında tek
   * çare topu YENİDEN GİRMEKtir ve o, aynı fiziksel top için ikinci bir barkod
   * doğurur. Kapsam dar; engelliyse backend somut Türkçe sebep döner ve panel
   * butonu zaten çizmez (`canRestore` aynı yüklemden gelir).
   */
  restoreCancel: (id: string, reason?: string): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>(`/api/rolls/${id}/restore-cancel`, reason ? { reason } : {})
      .then((r) => r.data),

  /**
   * İPTAL ÖNİZLEMESİ — "bu topu gerçekten kaldırabilir miyim, kaldırırsam ne olur".
   *
   * Yıkıcı-işlem kuralının (CLAUDE.md) istemci ayağı: pencere "3 kayıt etkilenecek"
   * demez, her topu tek tek sorup ENGELLİ olanları sebebiyle gösterir. Uç
   * 2026-08-05'ten beri vardı ama masaüstünden HİÇ çağrılmıyordu; toplu iptal
   * körlemesine deniyor, backend 409 veriyor ve pencere yalnız "1 başarısız"
   * yazıyordu (sebep `catch {}` içinde yutuluyordu).
   */
  cancelPreview: (id: string): Promise<ApiResponse<RollCancelPreview>> =>
    apiClient
      .get<ApiResponse<RollCancelPreview>>(`/api/rolls/${id}/cancel-preview`)
      .then((r) => r.data),

  /**
   * İPTAL — "bu kayıt hiç olmamalıydı". Stok DÜŞMEZ (mal zaten yoktu), fire
   * raporuna girmez. Parametreler query'de: uç `DELETE` ve gövdeli DELETE bazı
   * ara katmanlarda sessizce düşer.
   */
  cancel: (
    id: string,
    opts?: { reason?: string; reasonCode?: string },
  ): Promise<ApiResponse<Roll>> => {
    const qs = new URLSearchParams();
    // İstasyonda aktif top için bilinçli onay — pencere bunu ZATEN önizlemede
    // gösterip operatöre onaylattığı için burada açık gönderilir.
    qs.set("confirmActive", "true");
    if (opts?.reason) qs.set("reason", opts.reason);
    if (opts?.reasonCode) qs.set("reasonCode", opts.reasonCode);
    return apiClient
      .delete<ApiResponse<Roll>>(`/api/rolls/${id}?${qs.toString()}`)
      .then((r) => r.data);
  },

  /**
   * FİRE — "mal vardı, artık yok". Stok GERÇEKTEN düşer, fire raporuna girer.
   * İptalden ayrı uç ve ayrı izin (`roll:manual-adjust`): ikisini tek tuşa
   * indirmek fabrikanın fire oranını veri düzeltmeleriyle kirletir.
   */
  scrap: (
    id: string,
    body?: { reason?: string; reasonCode?: string },
  ): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>(`/api/rolls/${id}/scrap`, {
        ...body,
        confirmActive: true,
      })
      .then((r) => r.data),
};

/** `GET /api/rolls/:id/cancel-preview` yanıtı — backend `RollCancelPreview` aynası. */
export interface RollCancelPreview {
  rollId: string;
  barcode: string | null;
  status: string;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  /** Hard-block yoksa true. false ise `blockReason` DOLU ve top denenmez. */
  canCancel: boolean;
  blockReason: string | null;
  /** İstasyonda/iş emrinde aktif — pencere bunu ayrıca gösterir. */
  requiresConfirm: boolean;
  activeAt: {
    stepId: string;
    stationName: string | null;
    stationKind: string | null;
    workOrderId: string;
    batchNumber: string | null;
  } | null;
  openMovementCount: number;
  /** BİLGİ — kapı DEĞİL (2026-08-25'te ölü etiket onayı kaldırıldı). */
  labelPrinted: boolean;
  labelPrintedAt: string | null;
}

export const ROLL_STATUS_TABS = STATUS_GROUPS;
export type RollStatusTabKey = keyof typeof ROLL_STATUS_TABS;

/**
 * Sekme → backend'e zorla gönderilen taban filtre (forceFilters). Tablo
 * (useDataTable) ve üst-satır özeti (useRollStats) AYNI tabanı paylaşsın diye
 * tek kaynak — yoksa liste ile "Top/Metre" toplamı birbirinden sapar.
 */
/**
 * Sekmenin VARSAYILAN sıralama kolonu.
 *
 * `createdAt` yalnız "oluşturma = buraya geliş" olan sekmede doğrudur (Ham Stok:
 * KK1 girişi). Diğer sekmelerde top oraya SONRADAN gelir — depoya bugün giren bir
 * top haftalar önce yaratılmış olabilir (kurtarma, kapanış dispozisyonu, fason
 * kabulü, finalize). `createdAt` sıralı listede binlerce satırın altına düşer ve
 * operatör "depoya gitmedi" sanır (2026-07-30 saha bulgusu: 700/1200/800 m toplar
 * 5280 satırlık Bitmiş Depo listesinin 5271-5279. sırasındaydı).
 *
 * `updatedAt` "son hareket" vekilidir — kesin giriş anı değil ama operatörün
 * aradığı şeye kıyasla dramatik biçimde daha yakın.
 */
export function rollTabDefaultSortBy(tab: RollStatusTabKey): string {
  // Yarı Mamul de giriş sekmesidir (mal dışarıdan alınıp doğrudan buraya yazılır),
  // yani orada da "oluşturma = buraya geliş" — Ham Stok ile aynı kural.
  return tab === "RAW_STOCK" || tab === "SEMI_FINISHED" ? "createdAt" : "updatedAt";
}

export function buildRollForceFilters(
  tab: RollStatusTabKey,
): Record<string, string | string[]> {
  // KK1 ham kumaş: henüz hiçbir adıma girmemiş STOCK topu — yarı mamul HARİÇ.
  // ⚠️ `RAW_STOCK_PURE`, `RAW_STOCK`'un daraltılmış ikizidir; `RAW_STOCK` ikisinin
  // birleşimidir ve mobil top seçicisi onu kullanır (bkz. inventory.service).
  if (tab === "RAW_STOCK") return { rollScope: "RAW_STOCK_PURE", status: "ALL" };
  // Dışarıdan alınan yarı mamul — aynı statü, farklı stok türü.
  if (tab === "SEMI_FINISHED") return { rollScope: "SEMI_FINISHED", status: "ALL" };
  // Super-set: WO akışındaki tüm toplar (Fasonda + Kurşun/Tambur bekleyen + IN_PRODUCTION).
  if (tab === "PRODUCTION") return { rollScope: "PRODUCTION_ACTIVE", status: "ALL" };
  // Tambur sonrası depoya alınmış, sevke hazır.
  if (tab === "FINISHED_STOCK") return { rollScope: "FINISHED_STOCK", status: "ALL" };
  // Çuvalda: bir çuvala konmuş (sackId dolu), henüz sevk edilmemiş toplar.
  if (tab === "IN_SACK") return { rollScope: "IN_SACK", status: "ALL" };
  // Kurşun/KK2 istasyonunda bekleyen kayıtlar (status=ALL şart — yoksa default STOCK).
  // rollKind=OPEN_FABRIC filtresi KALDIRILDI (2026-07-27): "barkodlu top da
  // kesilebilir/işlenebilir" (2026-07-16) sonrası istasyonda barkodlu TOP meşru
  // bekler (Konumu-Düzelt / depodan WO'ya alınan top); barkod filtresi onları
  // gizleyip sekme sayısını Kanban'la çelişik gösteriyordu.
  if (tab === "KURSUN_PENDING")
    return { currentStepKind: "PROCESS_QC", status: "ALL" };
  // Tambur istasyonunda bekleyen kayıtlar (açık kumaş + barkodlu top).
  if (tab === "TAMBUR_PENDING")
    return { currentStepKind: "TAMBUR", status: "ALL" };
  const statusVal = ROLL_STATUS_TABS[tab];
  const out: Record<string, string | string[]> = {};
  if (statusVal) out.status = statusVal;
  return out;
}
