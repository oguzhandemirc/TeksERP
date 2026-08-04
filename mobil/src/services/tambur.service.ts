import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { RollCursorPage } from './roll.service';
import type {
  TamburStepSummary,
  TamburOpenCard,
  TamburFinalizeRequest,
  TamburReportErrorRequest,
  TamburContext,
  TamburCutRequest,
  TamburFinalizeOpenFabricRequest,
  Roll,
} from '../types/models';

/** GET /tambur/rolls/:id/undo-preview yanıtı (backend TamburUndoService). */
export interface TamburUndoPreview {
  /**
   * SINGLE = tek kesim parçası · FULL = finalize tümden · MANUAL = elle eklenen
   * topun kaydını geri al (2026-08-05).
   *
   * MANUAL'de "kaynak top" ve "geri dönecek metraj" kavramları YOKTUR: top
   * bir kesimden doğmadı, yoktan yaratıldı. Backend o alanları uyumluluk için
   * doldurur (parent = topun kendisi, restoredQty = 0) — ekran onları MANUAL'de
   * BASMAMALI, yoksa "0 m geri dönecek" gibi anlamsız bir cümle çıkar.
   */
  mode: 'SINGLE' | 'FULL' | 'MANUAL';
  canApply: boolean;
  blockReason: string | null;
  parent: { id: string; barcode: string | null; status: string; currentQty: number; initialQty: number };
  restoredQty: number;
  children: Array<{ id: string; barcode: string | null; status: string; qty: number; blockReason: string | null }>;
  reopenErrorCount: number;
  workOrder: { id: string; workOrderNumber: string; status: string; willRevive: boolean } | null;
  warnings: string[];
}
// =============================================================================
// SAHA DÜZELTMESİ (`/tambur/manual/*`) — backend `TamburManualService`
// =============================================================================
// İki uç: (1) mevcut topu bu Tambur adımına al, (2) sistemde HİÇ olmayan topu
// elle yarat + adıma bağla. Yetki: `mobile:tambur-duzelt` VEYA `roll:manual-adjust`.
// Hata gövdeleri makine-okunur `code` taşır (bkz. TAMBUR_MANUAL_BLOCK_CODES).

/** Saha ekranının topu tanıması için minimum özet (backend `FieldRollSummary`). */
export interface TamburFieldRoll {
  id: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  status: string;
  batchNumber: string | null;
  /** Topun ŞU ANKİ konumu — istasyon adı, yoksa depo/stok etiketi. */
  currentLocation: string;
  /** Topun bağlı olduğu iş emri (varsa). */
  workOrderNumber: string | null;
}

/** `POST /tambur/manual/bring-preview` — salt-okunur, hiçbir şeyi değiştirmez. */
export interface TamburBringPreview {
  roll: TamburFieldRoll;
  targetStep: {
    id: string;
    stationName: string;
    workOrderId: string;
    workOrderNumber: string;
  };
  canApply: boolean;
  blockCode: string | null;
  blockReason: string | null;
  warnings: string[];
  effects: {
    /** forward = ileri atlama (aradaki adımlar SKIPPED), backward = geri çekme. */
    direction: 'forward' | 'backward';
    fromStepName: string | null;
    skippedStepNames: string[];
    qualityWillVoid: boolean;
    qualityStaysUnknown: boolean;
    colorWillApply: boolean;
    newParty: boolean;
  } | null;
}

export interface TamburBringResult {
  rollId: string;
  barcode: string | null;
  targetStepId: string;
  workOrderNumber: string;
}

export interface TamburManualRollResult {
  rollId: string;
  barcode: string | null;
  itemId: string;
  colorId: string | null;
  /** OPERATOR = operatör seçti · WORKORDER = iş emrinden miras · NONE = renksiz. */
  colorSource: 'OPERATOR' | 'WORKORDER' | 'NONE';
  currentQty: number;
  targetStepId: string;
  workOrderNumber: string;
  /** true = aynı clientToken ile tekrar denendi, top zaten adımdaydı. */
  alreadyAttached: boolean;
  /** true = tamamlanmış iş emri bu işlemle yeniden açıldı. */
  reopenedWorkOrder: boolean;
  /** Bağlandığı parti — tek açık parti varsa backend SORMADAN bağlar. */
  batchId?: string | null;
  /** Parti numarası (P+GGAAYY+NNNN) — operatöre geri söylenir. */
  batchNumber?: string | null;
}

/**
 * `BATCH_REQUIRED` hatasının `details` gövdesi — iş emrinde BİRDEN FAZLA açık
 * parti olduğunda backend hiçbirini varsaymaz ve seçenekleri buraya koyar.
 *
 * Neden hata üzerinden ve neden ön yüklemeyle DEĞİL: "açık parti" tanımı veriye
 * dayanır (o partide hâlâ canlı top var mı) ve yalnız backend bilir. Listeyi
 * mobil ayrıca çözmeye kalkarsa iki kaynak doğar; operatör ekranda gördüğü
 * partiyi seçer ama backend onu kapanmış sayıp reddeder. Seçenekler her zaman
 * reddeden tarafın ağzından gelir.
 */
export interface BatchRequiredDetails {
  code: 'BATCH_REQUIRED';
  batches: { id: string; batchNumber: string }[];
}

/**
 * `POST /tambur/manual/roll` gövdesi.
 *
 * `colorId` ÜÇ DEĞERLİDİR ve üçü de farklı anlam taşır — alanı koşullu kur:
 *   • alan HİÇ gönderilmez → iş emrinin hedef rengi miras alınır
 *   • `null`               → AÇIKÇA renksiz (miras uygulanmaz)
 *   • uuid                 → operatörün seçtiği renk
 */
export interface TamburManualRollRequest {
  targetStepId: string;
  initialQty: number;
  reason: string;
  /** İdempotency anahtarı — MANTIKSAL deneme başına BİR kez üretilir. ZORUNLU. */
  clientToken: string;
  itemId?: string;
  colorId?: string | null;
  width?: number | null;
  qualityGrade?: string;
  /**
   * Topun bağlanacağı parti. GÖNDERİLMEZSE backend çözer: tek açık parti varsa
   * ona bağlar, birden fazlaysa `BATCH_REQUIRED` ile seçenekleri döner, hiç
   * yoksa partisiz bırakır. Yani ilk istek bilerek partisiz gider — operatöre
   * cevabı zaten belli olan bir soru sordurmamak için.
   */
  batchId?: string | null;
  /**
   * KAT — topun KALICI özelliği. Operatöre SORULUR (miras alınmaz): "o top
   * kesilerek yeni bir kat değeri kazanabilir" (2026-08-04 ürün kararı).
   * Gönderilmezse backend parent → iş emri planı sırasını uygular; elle
   * eklemede parent yoktur, yani sorulmazsa top kalıcı olarak katsız kalır
   * ve envanterin kat filtresinde hiç görünmez.
   */
  foldType?: string | null;
}

/**
 * `POST /tambur/manual/produce` gövdesi — KARTSIZ BİTMİŞ ürün ("Manuel Mod").
 *
 * **`TamburManualRollRequest` ile KARIŞTIRMA.** Orada `targetStepId` ZORUNLUDUR
 * ve çıktı bir iş emri adımına bağlanır (`IN_PRODUCTION`) — o uç "kart var ama
 * top ekranda yok" içindir. Burada `targetStepId` YOKTUR ve olmayacaktır: ucun
 * ayırt edici özelliği tam olarak kart/adım gerektirmemesidir. Buna karşılık
 * `itemId` ZORUNLU — miras alınacak iş emri yok.
 *
 * Çıkan top doğrudan **Bitmiş Depo**'ya (`WAREHOUSE`) yazılır; statü RENKTEN
 * çözülmez → renksiz (ham beyaz) bitmiş top da depoya iner, ham stoğa DÜŞMEZ.
 */
export interface TamburManualProduceRequest {
  /** ZORUNLU — kart olmadığı için miras alınacak hedef ürün yok. */
  itemId: string;
  /** null / gönderilmemiş = renksiz. Statüyü ETKİLEMEZ (her hâlükârda depo). */
  colorId?: string | null;
  initialQty: number;
  /** Katalog kodu; verilmezse kalite "Belirsiz" kalır. */
  qualityGrade?: string;
  width?: number | null;
  weightKg?: number;
  /**
   * KAT — Manuel Mod'da OPERATÖRDEN SORULUR (mobilde zorunlu, API'de opsiyonel).
   * Bu yolda hiç bağlam yok (iş emri/adım/parent yok) → sorulmazsa top kalıcı
   * olarak katsız kalır ve sonradan türetilemez.
   */
  foldType?: string | null;
  /** Etiket niyeti ("Kime?") — ikisi de boşsa stok. Kesim uçlarıyla aynı adlar. */
  targetOrderLineId?: string | null;
  targetCustomerId?: string | null;
  markedForKartela?: boolean;
  /** Min 3 karakter — audit'e kalıcı yazılır (zincir-dışı doğumun gerekçesi). */
  reason: string;
  /** İdempotency anahtarı — MANTIKSAL deneme başına BİR kez üretilir. ZORUNLU. */
  clientToken: string;
}

/** `POST /tambur/manual/produce` yanıtı (mobilin TÜKETTİĞİ alanlar). */
export interface TamburManualProduceResult {
  rollId: string;
  barcode: string | null;
  /** Her zaman `WAREHOUSE` — backend statüyü AÇIKÇA verir, renkten çözmez. */
  status: string;
  itemId: string;
  colorId: string | null;
  currentQty: number;
  qualityGrade: string | null;
  markedForKartela: boolean;
  /** true = aynı clientToken ile tekrar denendi; YENİ top DOĞMADI, eskisi döndü. */
  idempotentReplay: boolean;
}

// Tambur (final + karar) operatör akışı.
// Backend: src/services/tambur.service.ts

export interface TamburDeleteErrorRequest {
  errorId: string;
}

export const tamburService = {
  // Refakat kartı barkodu ile Tambur adımını + açık topları çek
  getByCardBarcode: (barcode: string): Promise<ApiResponse<TamburStepSummary>> =>
    apiClient
      .get<ApiResponse<TamburStepSummary>>(
        `/tambur/by-card/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),

  // Adım ID'siyle direkt çek — refresh için
  getStep: (stepId: string): Promise<ApiResponse<TamburStepSummary>> =>
    apiClient
      .get<ApiResponse<TamburStepSummary>>(`/tambur/step/${stepId}`)
      .then((r) => r.data),

  // PROCESS_QC değil; TAMBUR adımlarındaki açık kartlar — kamera modal'ı için
  listOpenCards: (): Promise<ApiResponse<TamburOpenCard[]>> =>
    apiClient
      .get<ApiResponse<TamburOpenCard[]>>('/tambur/open-cards')
      .then((r) => r.data),

  // Hata kararı + roll-split + finalize → top WAREHOUSE'a, parçalar yeni Roll
  finalize: (data: TamburFinalizeRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/tambur/finalize', data)
      .then((r) => r.data),

  // Tambur'da yeni hata kaydı (Kurşun'da yakalanmamış)
  reportError: (data: TamburReportErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/tambur/report-error', data)
      .then((r) => r.data),

  // Tambur karar vermeden hata silme (Kurşun'un deleteError'ıyla aynı yapı)
  deleteError: (data: TamburDeleteErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .delete<ApiResponse<unknown>>('/kursun-qc/error', { data })
      .then((r) => r.data),
  // ↑ Not: backend tarafında ayrı tambur deleteError endpoint'i yok; Kurşun'un
  // delete-error'u doğrudan errorId üzerinden çalışıyor (isProcessed=false ise).
  // Sahada Tambur henüz karar vermediği için aynı endpoint güvenle kullanılabilir.

  // NOT: createSwatch kaldırıldı — kartela artık Tambur'da kesilmiyor, fason
  // dönüşünden doğuyor (kartelaService). Bkz. docs/design/KARTELA-TASARIM.md.

  /**
   * GERİ AL önizlemesi (salt-okunur) — rollId çocuk da olabilir kaynak top da;
   * mod (SINGLE = tek parça iptali / FULL = finalize'ı tümden geri al) sunucuda
   * çözülür. canApply=false ise blockReason gösterilir, apply çağrılmaz.
   */
  undoPreview: (rollId: string): Promise<ApiResponse<TamburUndoPreview>> =>
    apiClient
      .get<ApiResponse<TamburUndoPreview>>(`/tambur/rolls/${rollId}/undo-preview`)
      .then((r) => r.data),

  /** GERİ AL uygula — backend tx-içi taze guard'larla korur (yarışta 409). */
  applyUndo: (rollId: string): Promise<ApiResponse<{ mode: string; cancelledChildIds: string[]; restoredQty: number }>> =>
    apiClient
      .post<ApiResponse<{ mode: string; cancelledChildIds: string[]; restoredQty: number }>>(
        `/tambur/rolls/${rollId}/undo`,
        {},
      )
      .then((r) => r.data),

  // Tambur'dan çıkmış son toplar — etiket yeniden basımı için liste
  // Cursor-paginated + aramalı. Modal infinite scroll için (RollCursorPage).
  recentOutputRolls: (params?: {
    workOrderId?: string;
    limit?: number;
    cursor?: string | null;
    search?: string;
    withTotal?: boolean;
  }): Promise<RollCursorPage> => {
    const qs = new URLSearchParams();
    qs.set('mode', 'cursor');
    if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.search) qs.set('search', params.search);
    if (params?.withTotal) qs.set('withTotal', 'true');
    return apiClient
      .get<RollCursorPage>(`/tambur/recent-output-rolls?${qs.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Yeni açık kumaş modeli — boyahane dönüşü. WO + sipariş progress + LIFO açık
   * kumaş listesini tek atışta döner. Kart pasif veya WO Tambur'da değilse 400.
   */
  getContext: (cardBarcode: string): Promise<ApiResponse<TamburContext>> =>
    apiClient
      .get<ApiResponse<TamburContext>>(
        `/tambur/context/${encodeURIComponent(cardBarcode)}`
      )
      .then((r) => r.data),

  /**
   * KURŞUN BYPASS kapanışı — kurşun makinelerinde tablet yoktur; iş Kurşun
   * Dağıtım ekranından fiziksel bir kurşun MAKİNESİNE atanır. Tambur tabletinde
   * refakat kartı okutulunca bu uç SESSİZCE çağrılır (operatör hiçbir şey
   * onaylamaz): Kurşun/KK2 adımı COMPLETED olur (SKIPPED DEĞİL) ve toplar
   * Tambur adımına geçer. Kalite NULL kalır — kaliteyi Tambur belirler.
   *
   * `rollIds` KAPSAM sözleşmesidir: `bypassPending.rolls` BİREBİR gönderilir —
   * kapsam bu sırada değiştiyse backend 409 döner (yarım kapanış yok) ve çağıran
   * kapsamı tazeleyip bir kez yeniden dener. Online-only: offline kuyruğuna
   * girmez (applyUndo ile aynı sınıf).
   */
  bypassComplete: (
    cardBarcode: string,
    rollIds: string[]
  ): Promise<
    ApiResponse<{
      alreadyDone: boolean;
      movedRollCount: number;
      tamburStepId: string | null;
      workOrderId: string;
    }>
  > =>
    apiClient
      .post<
        ApiResponse<{
          alreadyDone: boolean;
          movedRollCount: number;
          tamburStepId: string | null;
          workOrderId: string;
        }>
      >('/tambur/bypass-complete', { cardBarcode, rollIds })
      .then((r) => r.data),

  /**
   * Açık kumaşta tek kesim — child Roll (barkodlu) oluşur, parent açık kumaşın
   * currentQty'i kalan metreye düşer. Status WAREHOUSE/SCRAP/A1_STOCK.
   */
  cutOpenFabric: (
    rollId: string,
    data: TamburCutRequest
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/tambur/${rollId}/cut`, data)
      .then((r) => r.data),

  /**
   * Açık kumaşı bitir — parent Roll TAMBUR_CONSUMED'a çekilir. scrapRemaining=
   * true ise kalan metre fire child Roll olarak kaydedilir. foldType/layerCount
   * verilmezse WO planlanan değerleri kullanılır.
   */
  finalizeOpenFabric: (
    rollId: string,
    data: TamburFinalizeOpenFabricRequest
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/tambur/${rollId}/finalize-open-fabric`, data)
      .then((r) => r.data),

  /**
   * Top Kesme — depo (WAREHOUSE) topundan çoklu kesim. Her çağrı child Roll
   * doğurur, parent.currentQty düşer (parent yaşamaya devam eder). Parent
   * özellikleri ve KURSUN/QC2 operasyonları child'a inherit edilir.
   */
  cutWarehouseRoll: (
    rollId: string,
    data: { cutLength: number; qualityGrade?: string | null; notes?: string | null; targetOrderLineId?: string | null; targetCustomerId?: string | null; markedForKartela?: boolean; rawDestination?: 'STOCK' | 'WAREHOUSE'; clientToken?: string }
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> =>
    apiClient
      .post<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>>(
        `/tambur/${rollId}/cut-warehouse`,
        data
      )
      .then((r) => r.data),

  /**
   * Top Kesme bitir — parent TAMBUR_CONSUMED'a (arşiv) çekilir; kalan kumaş için
   * remainingAction'a göre 1.KALITE/A1/FIRE child Roll oluşur veya discard.
   */
  finalizeWarehouseCut: (
    rollId: string,
    data: {
      remainingAction?: 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard';
      notes?: string | null;
    }
  ): Promise<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>>(
        `/tambur/${rollId}/finalize-warehouse-cut`,
        data
      )
      .then((r) => r.data),

  // ── Saha düzeltmesi (`/manual/*`) ─────────────────────────────────────────

  /**
   * "Topu Buraya Al" ÖNİZLEMESİ — salt-okunur. Topun nereden geleceğini, hangi
   * adımların atlanacağını, kalite kararının VOID olup olmayacağını ve yeni parti
   * doğup doğmayacağını döner. `canApply=false` ise `blockReason` gösterilir ve
   * `bringRoll` HİÇ çağrılmaz (önizlemesiz uygulama yok).
   */
  bringPreview: (data: {
    targetStepId: string;
    barcode?: string;
    rollId?: string;
  }): Promise<ApiResponse<TamburBringPreview>> =>
    apiClient
      .post<ApiResponse<TamburBringPreview>>('/tambur/manual/bring-preview', data)
      .then((r) => r.data),

  /**
   * "Topu Buraya Al" UYGULA — sebep ZORUNLU (min 3 karakter, audit'e yazılır).
   * Taşımanın kendisi backend'de panel taşımasıyla AYNI motordur.
   * Online-only: offline kuyruğuna girmez (bypassComplete ile aynı sınıf).
   */
  bringRoll: (data: {
    targetStepId: string;
    barcode?: string;
    rollId?: string;
    reason: string;
  }): Promise<ApiResponse<TamburBringResult>> =>
    apiClient
      .post<ApiResponse<TamburBringResult>>('/tambur/manual/bring', data)
      .then((r) => r.data),

  /**
   * "Manuel Top Ekle" — sistemde HİÇ olmayan topu yaratır ve doğrudan bu Tambur
   * adımına bağlar. Barkod SUNUCUDA üretilir; top `entrySource=MANUAL_ENTRY` ile
   * kalıcı olarak işaretlenir ve sebep audit'e yazılır. `clientToken` zorunlu.
   */
  createManualRoll: (
    data: TamburManualRollRequest
  ): Promise<ApiResponse<TamburManualRollResult>> =>
    apiClient
      .post<ApiResponse<TamburManualRollResult>>('/tambur/manual/roll', data)
      .then((r) => r.data),

  /**
   * "MANUEL EKLE" modu — KARTSIZ bitmiş ürün. Hiçbir iş emrine / adıma / partiye
   * bağlanmaz, top doğrudan Bitmiş Depo'ya yazılır. Barkod SUNUCUDA üretilir;
   * `entrySource=TAMBUR_MANUAL` (KK1'in `SUPPLIER_RECEIPT`'inden ve Electron
   * panelinin `MANUAL_ENTRY`'sinden AYRI değer — istek mobilden gelir ama KK1
   * taraması değildir) + audit `TAMBUR_MANUAL_PRODUCE` ile sebep kalıcı
   * kaydedilir. Online-only (barkod sunucudan gelir) — offline kuyruğuna girmez.
   */
  produceFinishedRoll: (
    data: TamburManualProduceRequest
  ): Promise<ApiResponse<TamburManualProduceResult>> =>
    apiClient
      .post<ApiResponse<TamburManualProduceResult>>('/tambur/manual/produce', data)
      .then((r) => r.data),
};
