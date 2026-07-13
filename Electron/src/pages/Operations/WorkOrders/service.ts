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
    },
  ) =>
    apiClient
      .post<
        ApiResponse<{
          newBatchId?: string;
          newBatchNumber?: string;
          sourceDeleted?: boolean;
        }>
      >(`/api/work-orders/${id}/split`, payload)
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
      completeWorkOrder?: boolean;
      orderLineAllocations?: { orderLineId: string; qty: number }[];
    },
  ) =>
    apiClient
      .post<ApiResponse<{ id: string; dispatchNo: string; consumedRollCount: number }>>(
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
  subcontractorName: string;
  dispatchedAt: string;
  totalQty: number;
  rollCount: number;
  /** Dönüşü yapılmış sevk kalemi sayısı. */
  receivedItemCount: number;
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

/**
 * Bir parti lane'i = bir Batch. Üye topların şu anki konum dağılımı, aktif refakat
 * kartı, fason sevkleri (K10) ve soy bağı (splitFrom / splitChildren). Kilit
 * TÜRETİLMİŞ: iptal edilmemiş sevki olan parti kilitlidir (düzenlenemez).
 */
export interface BatchLane {
  batchId: string;
  /** Parti kodu (P+GGAAYY+NNNN). */
  batchNumber: string;
  createdAt: string;
  /** İptal edilmemiş fason sevki varsa parti kilitli (K8 araçları kapalı). */
  locked: boolean;
  /** Partinin aktif refakat kartı (varsa). */
  cardNumber: string | null;
  cardBarcode: string | null;
  rollCount: number;
  currentPositions: BatchLanePosition[];
  dispatches: BatchLaneDispatch[];
  /** Aynı WO içinde bu partinin ayrıldığı kaynak parti (redye). */
  splitFrom: BatchLineageRef | null;
  /** Aynı WO içinde bu partiden ayrılan partiler (redye). */
  splitChildren: BatchLineageRef[];
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
}

/** Parti ayırma önizlemesi (izinli modlar + taşınabilecek toplar). */
export interface BatchSplitPreview {
  /** Parti durumundan türetilen izinli modlar (boş = ayrılamaz → blockReason). */
  allowedModes: SplitMode[];
  blockReason: string | null;
  /** Redye'de topların geri sarılacağı boyahane adımı. */
  colorStepId: string | null;
  rollCount: number;
  rolls: BatchSplitPreviewRoll[];
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
