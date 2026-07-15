import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import type { WorkOrder, TargetPropertyChangeImpact, TravelerCard } from "./types";

const base = createCrudService<WorkOrder>("/api/work-orders");

export const workOrderService = {
  ...base,

  /**
   * Parti kodu blur kontrolü — kaydetmeden önce benzersizlik uyarısı.
   * excludeId düzenleme modunda WO'nun kendi kodunu çakışma saymaz.
   */
  checkBatchNumber: (batchNumber: string, excludeId?: string) =>
    apiClient
      .get<ApiResponse<{ batchNumber: string; available: boolean }>>(
        "/api/work-orders/check-batch-number",
        { params: { batchNumber, ...(excludeId ? { excludeId } : {}) } },
      )
      .then((r) => r.data),

  /** İptal önizleme: stoğa dönecek toplar + void olacak kart sayısı. */
  getCancelImpact: (id: string) =>
    apiClient
      .get<ApiResponse<WorkOrderCancelImpact>>(`/api/work-orders/${id}/cancel-impact`)
      .then((r) => r.data),

  /** Frontend uyarısı için: değişiklik kaç rulo etkiler? */
  getTargetPropertiesImpact: (id: string) =>
    apiClient
      .get<ApiResponse<TargetPropertyChangeImpact>>(
        `/api/work-orders/${id}/target-properties/impact`,
      )
      .then((r) => r.data),

  /** WO targetProperties replace + bağlı Roll.properties senkronize. */
  updateTargetProperties: (id: string, propertyIds: string[]) =>
    apiClient
      .patch<ApiResponse<{ workOrderId: string; affectedRollCount: number }>>(
        `/api/work-orders/${id}/target-properties`,
        { propertyIds },
      )
      .then((r) => r.data),

  /**
   * İş emrini tüm ilişkileri ile birlikte yeniden yaz. Backend tarafı PLANNED +
   * üretime başlanmamış WO'lara izin verir; aksi halde 409 döner.
   */
  replace: (id: string, payload: Partial<WorkOrder>) =>
    apiClient
      .put<ApiResponse<WorkOrder>>(`/api/work-orders/${id}`, payload)
      .then((r) => r.data),

  /** İş emrinin tüm refakat kartlarını (ACTIVE/REPRINTED/...) versiyon sırasıyla döner. */
  getTravelerCardHistory: (id: string) =>
    apiClient
      .get<ApiResponse<TravelerCard[]>>(`/api/work-orders/${id}/traveler-cards/history`)
      .then((r) => r.data),

  /** Refakat kartının baskı-hazır HTML'i (TEK KAYNAK) — backend render eder; mobil
   *  + Electron birebir aynısını basar. QR sunucuda gömülü, text/html döner. */
  getTravelerCardHtml: (cardId: string) =>
    apiClient
      .get<string>(`/api/traveler-cards/${cardId}/html`, {
        responseType: "text",
        headers: { Accept: "text/html" },
      })
      .then((r) => r.data),

  /** Refakat Kartı Ayarları canlı önizlemesi — örnek veri + DÜZENLENEN taslak config
   *  ile gerçek backend HTML (TASLAK filigranlı). Önizleme = gerçek baskı (tek kaynak). */
  getTravelerCardSampleHtml: (config: TravelerCardConfig) =>
    apiClient
      .post<string>(
        "/api/traveler-cards/sample-html",
        { config },
        { responseType: "text", headers: { Accept: "text/html" } },
      )
      .then((r) => r.data),

  /** Fason sevk irsaliyesinin CANLI talimat alanları (istenen renk + fason
   *  talimatı). Donmuş içerik PrintedDocument'ten gelir; bu overlay üzerine biner. */
  getDispatchDyeOverlay: (dispatchId: string) =>
    apiClient
      .get<ApiResponse<DispatchDyeOverlay>>(
        `/api/subcontractor/dispatches/${dispatchId}/dye-overlay`,
      )
      .then((r) => r.data),

  /** Fason talimatını güncelle — snapshot dışı canlı kolon; fiş baskısından önce
   *  talimat eklenebilir/düzeltilebilir. Boş gönderince temizlenir. */
  updateDispatchInstruction: (dispatchId: string, instruction: string | null) =>
    apiClient
      .patch<
        ApiResponse<{ id: string; dispatchNo: string; instruction: string | null }>
      >(`/api/subcontractor/dispatches/${dispatchId}/instruction`, { instruction })
      .then((r) => r.data),

  /** İş emrinin PARTİLERİ (Batch lane'leri) — "Partiler" paneli için. Her parti
   *  bir lane: üye topların şu anki konumu + fason sevkleri (K10) + soy bağı. */
  getBranches: (id: string) =>
    apiClient
      .get<
        ApiResponse<{
          batches: BatchLane[];
          /** Bu WO başka WO'nun partisinden ayrıldıysa (redye NEW_COLOR/UNDYED_MOVE) kaynak WO. */
          splitFrom: WorkOrderLineageRef | null;
          /** Bu WO'dan ayrılıp yeni WO'ya taşınan partiler. */
          splitChildren: WorkOrderSplitChild[];
        }>
      >(`/api/work-orders/${id}/branches`)
      .then((r) => r.data),

  /** Parti rota-zaman çizelgesi — birleşik hareket+operasyon geçmişi (adıma göre). */
  getBatchTimeline: (id: string, batchId: string) =>
    apiClient
      .get<ApiResponse<BatchTimeline>>(`/api/work-orders/${id}/batches/${batchId}/timeline`)
      .then((r) => r.data),

  /** Parti ayırma önizleme — izinli modlar + taşınacak toplar (hiçbir şeyi değiştirmez). */
  getSplitPreview: (id: string, batchId: string) =>
    apiClient
      .get<ApiResponse<BatchSplitPreview>>(
        `/api/work-orders/${id}/split-preview`,
        { params: { batchId } },
      )
      .then((r) => r.data),

  /** Partiyi ayır — REDYE_SAME_COLOR (aynı WO, yeni parti) / NEW_COLOR / UNDYED_MOVE. */
  splitBranch: (
    id: string,
    payload: {
      batchId: string;
      mode: SplitMode;
      newColorId?: string | null;
      orderMode?: "stock" | "keep";
      rollIds?: string[];
      /** Tebdil sebebi (opsiyonel) — audit'e yazılır. */
      reason?: string;
    },
  ) =>
    apiClient
      .post<ApiResponse<SplitBranchResult>>(`/api/work-orders/${id}/split`, payload)
      .then((r) => r.data),

  /** K8: Sevksiz partiden seçili topları başka bir sevksiz partiye taşı (aynı WO). */
  moveRolls: (rollIds: string[], toBatchId: string) =>
    apiClient
      .post<
        ApiResponse<{ movedCount: number; toBatchNumber: string; deletedBatchIds: string[] }>
      >("/api/batches/move-rolls", { rollIds, toBatchId })
      .then((r) => r.data),

  /** K8: Sevksiz partiden seçili topları YENİ partiye ayır (redye DEĞİL — saf idari bölme). */
  splitBatchRolls: (batchId: string, rollIds: string[]) =>
    apiClient
      .post<ApiResponse<{ newBatchId: string; newBatchNumber: string }>>(
        `/api/batches/${batchId}/split`,
        { rollIds },
      )
      .then((r) => r.data),

  /** K8: Sevksiz partileri birleştir — en eski parti no yaşar (survivor). */
  mergeBatches: (batchIds: string[]) =>
    apiClient
      .post<
        ApiResponse<{ survivorId: string; survivorNumber: string; mergedNumbers: string[] }>
      >("/api/batches/merge", { batchIds })
      .then((r) => r.data),

  /** Manuel konum düzeltme önizlemesi (süpervizör override) — hiçbir şeyi değiştirmez.
   *  Taşınabilir/engelli toplar + parti kararı gerekli mi + join adayları + uyarılar. */
  getManualMovePreview: (
    id: string,
    payload: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ) =>
    apiClient
      .post<ApiResponse<ManualMovePreview>>(`/api/work-orders/${id}/manual-move-preview`, payload)
      .then((r) => r.data),

  /** Manuel konum düzeltme uygula — parti/top rotada ileri-geri taşınır (gerekçe zorunlu). */
  manualMove: (
    id: string,
    payload: {
      batchId?: string;
      rollIds?: string[];
      targetStepId: string;
      partyMode?: ManualMovePartyMode;
      joinBatchId?: string;
      reason: string;
    },
  ) =>
    apiClient
      .post<ApiResponse<ManualMoveResult>>(`/api/work-orders/${id}/manual-move`, payload)
      .then((r) => r.data),

  /** Fason sevkini iptal et — Konumu Düzelt'te fasondaki topu içeri almanın gerçek-olay
   *  kısayolu (ham teleport yerine): çuvallar depoya döner, irsaliye VOID. */
  cancelFasonDispatch: (dispatchId: string, reason: string) =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/subcontractor/dispatches/${dispatchId}/cancel`, { reason })
      .then((r) => r.data),

  /** WO formu kapsama paneli — seçili sipariş kalemleri için net üretim açığı. */
  getCoverage: (lineIds: string[], excludeWorkOrderId?: string) =>
    apiClient
      .post<ApiResponse<CoverageLine[]>>("/api/orders/order-lines/coverage", {
        lineIds,
        ...(excludeWorkOrderId ? { excludeWorkOrderId } : {}),
      })
      .then((r) => r.data),

  /** Fasondan doğrudan sevk önizlemesi (salt-okunur). */
  getDirectShipPreview: (dispatchId: string) =>
    apiClient
      .get<ApiResponse<DirectShipPreview>>(
        `/api/subcontractor/dispatches/${dispatchId}/direct-ship-preview`,
      )
      .then((r) => r.data),

  /** Fasondan doğrudan sevk — seçilen topları sevk et, (ops.) WO tamamla + karşılanma. */
  directShip: (
    dispatchId: string,
    payload: {
      reason: string;
      rollIds?: string[];
      /** topId → sevk metre; topun kalanından azsa top bölünür (kısmi split). */
      rollShipQtys?: Record<string, number>;
      /** Mal kime gitti — zorunlu (DirectShipment + irsaliye). */
      customerId?: string;
      branchId?: string;
      completeWorkOrder?: boolean;
      orderLineAllocations?: { orderLineId: string; qty: number }[];
    },
  ) =>
    apiClient
      .post<
        ApiResponse<{
          id: string;
          dispatchNo: string;
          directShipmentNo: string | null;
          consumedRollCount: number;
        }>
      >(
        `/api/subcontractor/dispatches/${dispatchId}/direct-ship`,
        payload,
      )
      .then((r) => r.data),

  /** Fason→fason aktarımı geri alma önizlemesi (salt-okunur). */
  getUndoTransferPreview: (dispatchId: string) =>
    apiClient
      .get<ApiResponse<UndoTransferPreview>>(
        `/api/subcontractor/dispatches/${dispatchId}/undo-transfer-preview`,
      )
      .then((r) => r.data),

  /** Fason→fason aktarımı geri al — boyahane sevki + kaynak kabul iptal; mal kaynak fasona döner. */
  undoTransfer: (dispatchId: string, reason: string) =>
    apiClient
      .post<ApiResponse<{ id: string; dispatchNo: string }>>(
        `/api/subcontractor/dispatches/${dispatchId}/undo-transfer`,
        { reason },
      )
      .then((r) => r.data),

  /** Masaüstü toplu fason sevki — adımda bekleyen tüm topları okutmadan planlı/seçilen
   *  firmaya sevk eder (gerçek irsaliye + stok). subcontractorId yoksa adımın planlısı. */
  bulkDispatchStep: (payload: {
    workOrderId: string;
    stepId: string;
    subcontractorId?: string;
    /** Verilirse yalnız bu toplar; yoksa adımdaki bekleyen hepsi. */
    rollIds?: string[];
    /** Rota-atlama uyarısını bilinçli geç (ROUTE_SKIP override). */
    allowRouteSkip?: boolean;
    instruction?: string;
    plateNumber?: string;
    driverName?: string;
  }) =>
    apiClient
      // suppressErrorToast: ROUTE_SKIP'i bileşen kendi uyarı diyaloğuyla yönetir;
      // interceptor çift-toast atmasın (diğer hatalar bileşende toast'lanır).
      .post<ApiResponse<{ id: string; dispatchNo: string }>>(
        "/api/subcontractor/dispatch/bulk",
        payload,
        { suppressErrorToast: true },
      )
      .then((r) => r.data),

  /** Fasondan fasona doğrudan aktarım (zımpara→boyahane; içeride kabul + sonraki
   *  fasona sevk zinciri). Metraj 1:1 taşınır; kesin ölçüm boyahane dönüşünde. */
  transferToNextFason: (payload: {
    workOrderId: string;
    stepId: string;
    nextSubcontractorId?: string;
    /** Verilirse yalnız bu (fasonda bekleyen) toplar; yoksa hepsi. */
    rollIds?: string[];
    instruction?: string;
  }) =>
    apiClient
      .post<ApiResponse<{ id: string; dispatchNo: string }>>(
        "/api/subcontractor/transfer-next",
        payload,
      )
      .then((r) => r.data),

  /** Erken TASLAK fason çeki HTML'i — sonraki fason adımı için (sevkten önce,
   *  durum değiştirmez). Mal direkt fasondan fasona gidecekse çeki erken basılır. */
  getDraftFasonCeki: (workOrderId: string, stepId: string) =>
    apiClient
      .get<ApiResponse<{ html: string }>>("/api/subcontractor/fason-ceki-draft", {
        params: { workOrderId, stepId },
      })
      .then((r) => r.data),
};

/** Fasondan doğrudan sevk önizleme verisi (backend previewDirectShip). */
export interface DirectShipPreview {
  dispatchId: string;
  dispatchNo: string;
  cancelled: boolean;
  alreadyDirectShipped: boolean;
  subcontractor: { id: string; name: string };
  workOrder: { id: string; batchNumber: string; status: string };
  fasonStep: { id: string; stepSequence: number; stationName: string };
  affectedRolls: {
    id: string;
    barcode: string | null;
    currentQty: number;
    weightKg: number | null;
    itemCode: string;
    itemName: string;
    colorName: string | null;
  }[];
  downstreamStepsToSkip: { id: string; stepSequence: number; stationName: string }[];
  otherAtSubcontractor: number;
  woWillComplete: boolean;
  candidateOrderLines: {
    orderLineId: string;
    orderId: string;
    orderNumber: string;
    customerId: string | null;
    customerName: string | null;
    branchId: string | null;
    branchName: string | null;
    itemCode: string;
    itemName: string;
    colorName: string | null;
    width: number | null;
    quantity: number;
    shippedQty: number;
    remaining: number;
    suggestedQty: number;
    isWorkOrderLinked: boolean;
  }[];
}

/** Fason→fason aktarımı geri alma önizleme verisi (backend getUndoTransferPreview). */
export interface UndoTransferPreview {
  dispatchId: string;
  dispatchNo: string;
  /** Tüm guard'lar geçtiyse true; false ise blockingReasons doludur. */
  safe: boolean;
  blockingReasons: string[];
  subcontractorName: string;
  workOrder: { id: string; batchNumber: string; status: string };
  /** Aktarımın gönderildiği fason (geri alınacak sevkin adımı). */
  targetStationName: string;
  /** Malın geri döneceği kaynak fason adımı. */
  sourceStationName: string | null;
  /** İptal edilecek (CANCELLED'a çekilecek) born toplar. */
  bornRolls: {
    id: string;
    barcode: string | null;
    currentQty: number;
    status: string;
    itemCode: string;
    itemName: string;
    colorName: string | null;
  }[];
  /** Geri alınacak kaynak kabul(ler) + dönecek orijinal toplar. */
  sourceReceipts: {
    id: string;
    receiptNo: string;
    stationName: string | null;
    originalRolls: {
      id: string;
      barcode: string | null;
      currentQty: number;
      status: string;
      itemCode: string;
      itemName: string;
    }[];
  }[];
}

/** Manuel taşımada parti kararı — backend `PartyMode` ile birebir.
 *  keep = kimlik korunur (tüm parti) · new = yeni parti (splitFrom) · join = hedef partiye kat. */
export type ManualMovePartyMode = "keep" | "new" | "join";

/** Manuel taşıma önizlemesindeki tek top (taşınabilir mi + neden değil). */
export interface ManualMovePreviewRoll {
  id: string;
  barcode: string | null;
  batchNumber: string | null;
  currentStepId: string | null;
  /** Şu anki konumu (istasyon adı / "Depo" / "—"). */
  currentStepName: string;
  currentQty: number;
  movable: boolean;
  blockReason: string | null;
  /** Geri-taşımada bu topun hedef-sonrası kalite/kurşun kararı geri alınacak (grade → Belirsiz). */
  qcWillVoid?: boolean;
}

/** Manuel taşıma önizlemesi (backend getManualMovePreview). */
export interface ManualMovePreview {
  targetStep: { id: string; stepSequence: number; name: string | null; type: string | null };
  /** Seçim tek partinin TÜM canlı topları mı (→ kimlik korunur, karar gerekmez). */
  isWholeParty: boolean;
  /** Kısmi taşıma → parti kararı (new/join) gerekir. */
  partyDecisionNeeded: boolean;
  rolls: ManualMovePreviewRoll[];
  movableCount: number;
  blockedCount: number;
  /** 'join' adayları — aynı WO'da sevksiz (kilitsiz) diğer partiler. */
  candidateJoinParties: { batchId: string; batchNumber: string }[];
  /** Fasondaki seçili toplar için açık fason sevkleri — inline Sevk İptali / Fason Kabul. */
  openDispatches: { dispatchId: string; dispatchNo: string; stepName: string | null }[];
  /** İleri-atlama (Milestone Backflush) önizlemesi. */
  backflush: {
    direction: "forward" | "backward";
    /** Bypass edilecek ara adım adları (SKIPPED olacak). */
    skippedStepNames: string[];
    /** Renk-veren adım atlanıyor → renk WO hedef renginden uygulanacak. */
    appliesColor: boolean;
    /** Hedef renk yok → renk-veren adım atlanamaz (taşıma engellenir). */
    colorBlocked: boolean;
    /** Kalite adımı atlanıyor → grade "Belirsiz" kalır (sentezlenmez). */
    qualityStaysUnknown: boolean;
  };
  warnings: string[];
}

/** Manuel taşıma sonucu. */
export interface ManualMoveResult {
  movedRollCount: number;
  targetStepName: string | null;
  partyMode: ManualMovePartyMode;
  newBatchNumber: string | null;
  /** Tamamlanmış WO taşıma ile yeniden açıldıysa true. */
  reopened: boolean;
}

/** Parti (Batch) modeli ayırma modları — backend `SplitMode` ile birebir. */
export type SplitMode = "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";

/** Fason sevk / dal durumu (parti lane'i içindeki her sevk için). */
export type BatchDispatchStatus =
  | "OPEN"
  | "PARTIAL"
  | "RETURNED"
  | "CANCELLED"
  | "DIRECT_SHIPPED";

/** Parti üyesi topların şu anki konum dağılımı (istasyon adı / statü etiketi). */
export interface BatchLanePosition {
  label: string;
  count: number;
  totalMeters: number;
}

/** Parti içindeki bir fason sevki (K10: bir sevk = bir parti). */
export interface BatchLaneDispatch {
  dispatchId: string;
  dispatchNo: string;
  /** Hangi fason adımına gönderildi (istasyon adı). */
  stepName: string | null;
  /** Adım sırası (rota) — belge modalında Zımpara→Boyahane gruplarını sıralamak için. */
  stepSequence: number;
  subcontractorName: string;
  dispatchedAt: string;
  totalQty: number;
  rollCount: number;
  /** Dönüşü yapılmış sevk kalemi sayısı. */
  receivedItemCount: number;
  /** Kapanış bakiyesi (metraj): dönen (kabul), fasondan sevk edilen. Fasonda kalan =
   *  totalQty − returnedQty − directShippedQty. */
  returnedQty: number;
  directShippedQty: number;
  /** OPEN = fasonda · PARTIAL = kısmi dönüş · RETURNED = döndü · CANCELLED = iptal ·
   *  DIRECT_SHIPPED = fasondan doğrudan sevk (mal dönmeden müşteriye gitti). */
  status: BatchDispatchStatus;
  /** Bu sevk bir fason→fason aktarımın çıktısı mı (tüm topları born) → "Aktarımı Geri Al". */
  isTransferOutput: boolean;
  directShippedAt?: string | null;
  directShipReason?: string | null;
  receipts: { receiptNo: string; receivedAt: string }[];
}

/** Parti soy bağı — aynı WO içinde ayrılan/kaynak parti (P kodu). */
export interface BatchLineageRef {
  id: string;
  batchNumber: string;
}

/** Parti üyesi TEK top — "hangi partide hangi top var" sorusunun cevabı (kimlik). */
export interface BatchLaneRoll {
  id: string;
  barcode: string | null;
  status: string;
  currentQty: number;
  /** Şu anki konumu (istasyon adı veya statü etiketi — currentPositions'ın kaynağı). */
  positionLabel: string;
  item: { name: string } | null;
  color: { name: string; hex: string | null } | null;
}

/**
 * Bir parti lane'i = bir Batch. Üye topların şu anki konum dağılımı, aktif refakat
 * kartı, fason sevkleri (K10) ve soy bağı (splitFrom / splitChildren). Kilit
 * TÜRETİLMİŞ: iptal edilmemiş sevki olan parti kilitlidir (düzenlenemez).
 */
/** Partiye ait fasondan sevk (DSK) — Parti Geçmişi "Fasondan Sevkler" satırı. */
export interface BatchDirectShipment {
  id: string;
  shipmentNo: string;
  customerName: string | null;
  totalQty: number;
  rollCount: number;
  shippedAt: string;
}

export interface BatchLane {
  batchId: string;
  /** Parti kodu (P+GGAAYY+NNNN). */
  batchNumber: string;
  createdAt: string;
  /** İptal edilmemiş fason sevki varsa parti kilitli (K8 araçları kapalı). */
  locked: boolean;
  /** Topları bir fason adımında ÜRETİMDE ama sevk edilmemiş (redye geri-sarımı / ilk
   *  sevk öncesi) → sahadan Fason Sevk ile boyahaneye gönderilmeyi bekliyor. */
  awaitingFasonDispatch: boolean;
  /** Partinin aktif refakat kartı (varsa). */
  cardNumber: string | null;
  cardBarcode: string | null;
  rollCount: number;
  currentPositions: BatchLanePosition[];
  /** Partinin toplarının tek tek listesi — "hangi partide hangi top var". */
  rolls: BatchLaneRoll[];
  dispatches: BatchLaneDispatch[];
  /** Fasondan sevkler (DSK) — mal fasondan doğrudan müşteriye gitti (Parti Geçmişi). */
  directShipments: BatchDirectShipment[];
  /** Aynı WO içinde bu partinin ayrıldığı kaynak parti (redye). */
  splitFrom: BatchLineageRef | null;
  /** Aynı WO içinde bu partiden ayrılan partiler (redye). */
  splitChildren: BatchLineageRef[];
}

/** Bir operasyon türünün adım özetindeki toplu görünümü (RollOperation). */
export interface BatchTimelineOperation {
  /** KURSUN_APPLIED | QC2_COMPLETED | TAMBUR_PROCESSED | SUBCONTRACTOR_SENT | SUBCONTRACTOR_RETURNED */
  type: string;
  count: number;
  lastAt: string;
  operators: string[];
}

/** Parti timeline'ında bir rota adımı — partinin o adımdaki geçişi + operasyonları. */
export interface BatchTimelineStep {
  stepId: string;
  stepSequence: number;
  stationName: string;
  stationType: string | null;
  /** Partinin herhangi bir topu bu adıma uğradı mı (hareket kaydı). */
  visited: boolean;
  rollCount: number;
  enteredAt: string | null;
  exitedAt: string | null;
  operations: BatchTimelineOperation[];
}

export interface BatchTimeline {
  batchId: string;
  batchNumber: string;
  rollCount: number;
  steps: BatchTimelineStep[];
}

/** İş emri soy bağı — WO seviyesi ayrılma (redye NEW_COLOR/UNDYED_MOVE → yeni WO). */
export interface WorkOrderLineageRef {
  id: string;
  workOrderNumber: string;
}

/** Bu WO'dan ayrılıp yeni iş emrine taşınan parti (WO-seviyesi iz satırı). */
export interface WorkOrderSplitChild {
  id: string;
  workOrderNumber: string;
  status: string;
  createdAt: string;
  targetColor: { id: string; name: string; hex: string | null } | null;
}

/** Parti ayırma önizlemesindeki tek top (backend minimal select). */
export interface BatchSplitPreviewRoll {
  id: string;
  status: string;
  currentQty: number;
  currentStepId: string | null;
  /** Redye/NEW_COLOR için uygun mu (çuval/sevk yok + boyahane adımında/sonrasında). */
  eligible: boolean;
}

/** Parti ayırma önizlemesi (izinli modlar + taşınabilecek toplar). */
export interface BatchSplitPreview {
  /** Parti durumundan türetilen izinli modlar (boş = ayrılamaz → blockReason). */
  allowedModes: SplitMode[];
  blockReason: string | null;
  /** Redye'de topların geri sarılacağı boyahane adımı. */
  colorStepId: string | null;
  /** Kaynak WO'nun mevcut hedef rengi (NEW_COLOR seçicisinde referans). */
  sourceTargetColorId: string | null;
  rollCount: number;
  /** Redye/NEW_COLOR için uygun top sayısı (karma-adım partide < rollCount olabilir). */
  eligibleCount: number;
  rolls: BatchSplitPreviewRoll[];
}

/** Partiyi ayır yanıtı — REDYE (aynı WO, yeni parti) / NEW_COLOR / UNDYED_MOVE (yeni WO). */
export interface SplitBranchResult {
  /** REDYE_SAME_COLOR / NEW_COLOR: doğan yeni parti. */
  newBatchId?: string;
  newBatchNumber?: string;
  sourceDeleted?: boolean;
  sourceBatchDeleted?: boolean;
  /** NEW_COLOR / UNDYED_MOVE: doğan yeni iş emri. */
  newWorkOrderId?: string;
  newWorkOrderNumber?: string;
  /** UNDYED_MOVE: taşınan parti + açık sevk. */
  movedBatchId?: string;
  movedBatchNumber?: string;
  movedRollCount?: number;
  dispatchNo?: string;
}

export interface CoverageLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  requested: number;
  shipped: number;
  /** Bu spec'i üreten canlı WO'ların in-flight'ı (committed − finished). Spec-havuz. */
  inProduction: number;
  /** Etiketsiz, eşleşen depodaki hazır stok. */
  freeWarehouse: number;
  /** Etiketsiz, eşleşen ham stok. */
  freeStock: number;
  /** istenen − sevk − üretimde − serbest depo − ham. Eksi = fazla (üretme). */
  netGap: number;
}

export interface CancelImpactRoll {
  id: string;
  barcode: string | null;
  status: string;
  currentQty: number;
  colorName: string | null;
  colorHex: string | null;
  propertyCount: number;
  /** Ham değil — boyalı/özellikli/fason-dönüşü. */
  processed: boolean;
  /** Hâlâ fason/boyahanede (fiziksel olarak dışarıda). */
  atSubcontractor: boolean;
}

export interface WorkOrderCancelImpact {
  workOrderId: string;
  batchNumber: string;
  status: string;
  canCancel: boolean;
  blockReason: string | null;
  travelerCardCount: number;
  rollCount: number;
  processedCount: number;
  atSubcontractorCount: number;
  rolls: CancelImpactRoll[];
}

/** Donmuş fason sevk irsaliyesindeki tek top satırı (PrintedDocument.doc.rolls). */
export interface DispatchPrintRoll {
  sequence: number;
  id: string;
  barcode: string | null;
  itemCode: string | null;
  itemName: string | null;
  colorCode: string | null;
  colorName: string | null;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  qualityGrade: string;
  width: number | null;
}

/** Donmuş fason sevk irsaliyesi payload'ı (PrintedDocument.snapshot.doc). */
export interface FasonDispatchDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  workOrder: {
    id: string;
    batchNumber: string;
    parameters: Record<string, unknown> | null;
    type: string;
  };
  subcontractor: {
    id: string;
    name: string;
    code: string | null;
  };
  step: {
    id: string;
    stepSequence: number;
    station: { name: string; code: string };
  };
  rolls: DispatchPrintRoll[];
  totals: {
    rollCount: number;
    totalQty: number;
    totalWeight: number;
  };
}

/** Fason sevk irsaliyesinin CANLI talimat alanları (donmuş içeriğin dışında). */
export interface DispatchDyeOverlay {
  /** WO hedef rengi — fasoncudan istenen renk. Canlı join. */
  requestedColor: {
    id: string;
    code: string;
    name: string;
    hex: string | null;
  } | null;
  /** Fason talimatı — sevk notundan ayrı, canlı kolon (override). */
  instruction: string | null;
  /** Sevkin adımının notu (default) — sevkin kendi talimatı boşsa fişte buna düşülür. */
  stepNote: string | null;
  /** Sevk iptal/kabul edildiyse talimat düzenlenemez (editör disabled). */
  instructionLocked: boolean;
}
