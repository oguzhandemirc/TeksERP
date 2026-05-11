import type { StepStatus, WorkOrderStatus, WorkOrderType } from "@/types/enums";

export interface WorkOrderStepLite {
  id: string;
  stepSequence: number;
  status: StepStatus;
  station?: { id: string; code: string; name: string; type?: string };
  /** findById include eder; list view'de yok. */
  notes?: string | null;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
}

export interface WorkOrderTargetItem {
  id: string;
  code: string;
  name: string;
  isDerived: boolean;
  baseItemId: string | null;
  colorId: string | null;
  color?: { id: string; code: string; name: string; hex: string | null } | null;
}

export interface WorkOrderTargetPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface WorkOrder {
  id: string;
  batchNumber: string;
  type: WorkOrderType;
  status: WorkOrderStatus;
  width: number | null;
  targetQuantity: number | null;
  recipeNo: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  routeTemplateId: string | null;
  targetItemId: string | null;
  servicePricePerMeter: string | null;
  steps: WorkOrderStepLite[];
  routeTemplate?: { id: string; code: string | null; name: string } | null;
  targetItem?: WorkOrderTargetItem | null;
  /** Tambur'da finalize edilen rulolarda olacak özellikler. */
  targetProperties?: WorkOrderTargetPropertyLink[];
  orderLinks?: {
    orderLineId: string;
    allocatedQty: number;
    orderLine?: {
      quantity: number;
      width: number | null;
      order?: {
        id: string;
        orderNumber: string;
        deadline?: string | null;
        customer?: { id: string; code: string; name: string } | null;
      };
      item?: {
        id: string;
        name: string;
        color?: { id: string; code: string; name: string; hex: string | null } | null;
      };
      variant?: { id: string; name: string } | null;
      requiredProperties?: {
        propertyId: string;
        property: { id: string; name: string };
      }[];
    };
  }[];
  createdAt: string;
  updatedAt: string;
}

/** WO targetProperties update endpoint'inin döndürdüğü impact bilgisi. */
export interface TargetPropertyChangeImpact {
  tamburPassedCount: number;
  inProductionCount: number;
}

export type TravelerCardStatus = "ACTIVE" | "REPRINTED" | "VOIDED" | "COMPLETED";

export interface TravelerCard {
  id: string;
  cardNumber: string;
  barcode: string;
  workOrderId: string;
  version: number;
  status: TravelerCardStatus;
  printedAt: string;
  printedById: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  printedBy?: { id: string; username: string; fullName: string | null } | null;
}
