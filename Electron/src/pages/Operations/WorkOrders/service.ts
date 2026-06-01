import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { WorkOrder, TargetPropertyChangeImpact, TravelerCard } from "./types";

const base = createCrudService<WorkOrder>("/api/work-orders");

export const workOrderService = {
  ...base,

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

  /** Sevk anında dondurulan fason sevk irsaliyesi snapshot'ı (yazdırma için). */
  getDispatchPrintSnapshot: (dispatchId: string) =>
    apiClient
      .get<ApiResponse<DispatchPrintSnapshot>>(
        `/api/subcontractor/dispatches/${dispatchId}/print`,
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
};

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

export interface DispatchPrintRoll {
  rollId: string;
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

export interface DispatchPrintSnapshot {
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
  /** WO hedef rengi — fasoncudan istenen renk. Snapshot dışı, canlı join. */
  requestedColor: {
    id: string;
    code: string;
    name: string;
    hex: string | null;
  } | null;
}
