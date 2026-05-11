import type { ShipmentStatus } from "@/types/enums";

export interface ShipmentItem {
  id: string;
  rollId: string;
  shippedQty: number;
  shippedWeight: number | null;
  rollBarcodeSnapshot: string | null;
  itemCodeSnapshot: string | null;
  itemNameSnapshot: string | null;
  orderNumberSnapshot: string | null;
}

export interface Shipment {
  id: string;
  shipmentNumber: string;
  customerId: string;
  branchId: string | null;
  status: ShipmentStatus;
  priority: number;
  driverName: string | null;
  plateNumber: string | null;
  carrier: string | null;
  plannedDate: string | null;
  shippedAt: string | null;
  shippedById: string | null;
  customerCodeSnapshot: string | null;
  customerNameSnapshot: string | null;
  branchNameSnapshot: string | null;
  customer?: { id: string; code: string; name: string };
  branch?: { id: string; code: string | null; name: string } | null;
  items?: ShipmentItem[];
  _count?: { items: number };
  shippedBy?: { id: string; fullName: string } | null;
  plannedOrders?: {
    id: string;
    orderId: string;
    sortOrder: number;
    note: string | null;
    order?: { id: string; orderNumber: string; status: string; deadline: string | null };
  }[];
  createdAt: string;
  updatedAt: string;
}
