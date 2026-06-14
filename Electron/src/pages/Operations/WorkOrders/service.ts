import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
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

  /** Fason sevk irsaliyesinin CANLI talimat alanları (istenen renk + boyahane
   *  notu). Donmuş içerik PrintedDocument'ten gelir; bu overlay üzerine biner. */
  getDispatchDyeOverlay: (dispatchId: string) =>
    apiClient
      .get<ApiResponse<DispatchDyeOverlay>>(
        `/api/subcontractor/dispatches/${dispatchId}/dye-overlay`,
      )
      .then((r) => r.data),

  /** Boyahane notunu güncelle — snapshot dışı canlı kolon; fiş baskısından önce
   *  talimat eklenebilir/düzeltilebilir. Boş gönderince temizlenir. */
  updateDispatchDyehouseNote: (dispatchId: string, dyehouseNote: string | null) =>
    apiClient
      .patch<
        ApiResponse<{ id: string; dispatchNo: string; dyehouseNote: string | null }>
      >(`/api/subcontractor/dispatches/${dispatchId}/dyehouse-note`, { dyehouseNote })
      .then((r) => r.data),

  /** Fason dalları (paralel sevk partileri) — tam sayfa lane görünümü için. */
  getBranches: (id: string) =>
    apiClient
      .get<
        ApiResponse<{
          branches: WorkOrderBranch[];
          /** Bu WO bir partiden ayrıldıysa kaynak WO. */
          splitFrom: { id: string; batchNumber: string } | null;
          /** Bu WO'dan ayrılan partilerin yeni WO'ları. */
          splitChildren: WorkOrderSplitChild[];
        }>
      >(`/api/work-orders/${id}/branches`)
      .then((r) => r.data),

  /** Partiyi (sevk lane'i) ayırma önizleme — taşınacak toplar + ayrılabilirlik. */
  getSplitPreview: (id: string, batchSplitId: string) =>
    apiClient
      .get<ApiResponse<BranchSplitPreview>>(
        `/api/work-orders/${id}/split-preview`,
        { params: { batchSplitId } },
      )
      .then((r) => r.data),

  /** Partiyi yeni iş emrine ayır (aynı rota + özellikler, yeni renk). */
  splitBranch: (
    id: string,
    payload: {
      batchSplitId: string;
      newColorId: string;
      newBatchNumber?: string | null;
      orderMode: "stock" | "keep";
      rollIds?: string[];
    },
  ) =>
    apiClient
      .post<ApiResponse<{ newWorkOrderId: string; batchNumber: string; movedRollCount: number }>>(
        `/api/work-orders/${id}/split`,
        payload,
      )
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

/** Bir fason dalının (sevk partisi) doğan toplarının şu anki konum dağılımı. */
export interface WorkOrderBranchPosition {
  /** İstasyon adı, ya da konumsuz toplar için statü etiketi (Depo / Tambur...). */
  label: string;
  count: number;
  totalMeters: number;
}

/** Bir fason dalı = bir SubcontractorDispatch (paralel sevk partisi). */
export interface WorkOrderBranch {
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
  status: "OPEN" | "PARTIAL" | "RETURNED" | "CANCELLED" | "DIRECT_SHIPPED";
  /** Doğrudan sevk işareti (DIRECT_SHIPPED dalları için). */
  directShippedAt?: string | null;
  directShipReason?: string | null;
  receipts: { receiptNo: string; receivedAt: string }[];
  /** Dönüşten doğan açık-kumaş toplarının şu anki konum dağılımı. */
  currentPositions: WorkOrderBranchPosition[];
}

/** Bu WO'dan ayrılan bir partinin yeni iş emri (Dallar panelinde iz satırı). */
export interface WorkOrderSplitChild {
  id: string;
  batchNumber: string;
  status: string;
  createdAt: string;
  targetColor: { id: string; name: string; hex: string | null } | null;
}

export interface BranchSplitPreviewRoll {
  id: string;
  barcode: string | null;
  currentQty: number;
  status: string;
  itemName: string | null;
  colorName: string | null;
}

export interface BranchSplitPreviewStep {
  id: string;
  stepSequence: number;
  stationName: string;
}

/** Partiyi yeni iş emrine ayırma önizlemesi (yıkıcı/yapısal işlem onayı için). */
export interface BranchSplitPreview {
  canSplit: boolean;
  blockReason: string | null;
  /** 'continue' = boyanmadan kaldığı yerden; 'redye' = boyahaneye geri sar (yeniden boya). */
  mode: "continue" | "redye" | null;
  dispatchNo: string;
  /** Partinin şu anki konumu. */
  currentStep: BranchSplitPreviewStep | null;
  /** Yeni WO'nun başlayacağı adım (redye'da boyahane). */
  reEntryStep: BranchSplitPreviewStep | null;
  sourceColor: { id: string; name: string; hex: string | null } | null;
  targetItem: { id: string; name: string } | null;
  hasOrderLinks: boolean;
  rolls: BranchSplitPreviewRoll[];
  rollCount: number;
  totalQty: number;
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
  /** Boyahaneye özel talimat — sevk notundan ayrı, canlı kolon. */
  dyehouseNote: string | null;
  /** WO'daki boyahane notu (default) — sevkin kendi notu boşsa fişte buna düşülür. */
  woDyehouseNote: string | null;
  /** Sevk iptal/kabul edildiyse not düzenlenemez (editör disabled). */
  dyehouseNoteLocked: boolean;
}
