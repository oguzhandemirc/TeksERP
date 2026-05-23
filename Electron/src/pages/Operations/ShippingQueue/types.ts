import type { OrderStatus, RollStatus } from "@/types/enums";

export const ShippingQueueStatus = {
  WAITING: "WAITING",
  TAKEN: "TAKEN",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type ShippingQueueStatus =
  (typeof ShippingQueueStatus)[keyof typeof ShippingQueueStatus];

export const shippingQueueStatusLabels: Record<ShippingQueueStatus, string> = {
  WAITING: "Bekliyor",
  TAKEN: "Alındı",
  DONE: "Tamamlandı",
  CANCELLED: "İptal",
};

export interface ShippingQueueLineAllocation {
  rollId: string;
  barcode: string | null;
  rollStatus: RollStatus;
  sackId: string | null;
  allocatedQty: number;
}

export interface ShippingQueueLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  width: number | null;
  requestedQty: number;
  allocatedQty: number;
  remainingQty: number;
  allocations: ShippingQueueLineAllocation[];
}

export interface ShippingQueueItem {
  id: string;
  orderId: string;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  status: ShippingQueueStatus;
  note: string | null;
  addedBy: { id: string; fullName: string };
  assignedOperator: { id: string; fullName: string } | null;
  takenAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    orderDate: string;
    deadline: string | null;
    currency: string;
    totalAmount: string | null;
    customer: { id: string; code: string; name: string };
    branch: {
      id: string;
      name: string;
      city: string | null;
      district: string | null;
    } | null;
    lines: ShippingQueueLine[];
    totalRequestedQty: number;
    totalAllocatedQty: number;
    remainingQty: number;
  };
}
