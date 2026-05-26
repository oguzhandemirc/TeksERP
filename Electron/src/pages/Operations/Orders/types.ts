import type { OrderStatus } from "@/types/enums";

export interface OrderLineColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface OrderLineItem {
  id: string;
  code: string;
  name: string;
  /** Item'ın olası özellikleri (allowed). Boşsa = serbest. */
  allowedProperties?: {
    propertyId: string;
    property: { id: string; code: string; name: string };
  }[];
  /** Item'ın olası renkleri (allowed). Boşsa = serbest. */
  allowedColors?: {
    colorId: string;
    color: OrderLineColor;
  }[];
}

export interface OrderLineRequiredPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface OrderLine {
  id: string;
  itemId: string;
  colorId: string | null;
  quantity: number;
  width: number | null;
  unitPrice: string | null;
  /** Müşteri-bazlı ürün adı override (1-shot). Boşsa master alias veya default'a düşer. */
  customerItemName: string | null;
  /** Müşteri-bazlı renk adı override (1-shot). */
  customerColorName: string | null;
  item?: OrderLineItem;
  color?: OrderLineColor | null;
  /** Müşterinin istediği özellikler — WO açılırken targetProperties önerisi olur. */
  requiredProperties?: OrderLineRequiredPropertyLink[];
  /** Kalemin bağlandığı WO'lar. Boş veya hepsi CANCELLED ise kalem düzenlenebilir. */
  workOrderLinks?: Array<{
    workOrderId: string;
    workOrder: { status: "PLANNED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED" };
  }>;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  branchId: string | null;
  currency: string;
  totalAmount: string | null;
  status: OrderStatus;
  shippedQty: number;
  orderDate: string;
  deadline: string | null;
  completedAt: string | null;
  manualClosedById: string | null;
  manualCloseReason: string | null;
  customer?: { id: string; code: string; name: string };
  branch?: { id: string; name: string; city: string | null; district: string | null } | null;
  lines: OrderLine[];
  createdAt: string;
  updatedAt: string;
}
