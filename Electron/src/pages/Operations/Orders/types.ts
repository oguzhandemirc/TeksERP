import type { OrderStatus } from "@/types/enums";

export interface OrderLineItem {
  id: string;
  code: string;
  name: string;
  isDerived: boolean;
  baseItemId: string | null;
  colorId: string | null;
  color?: { id: string; code: string; name: string; hex: string | null } | null;
  /** Item'ın olası özellikleri (allowed). Boşsa = serbest. */
  allowedProperties?: {
    propertyId: string;
    property: { id: string; code: string; name: string };
  }[];
}

export interface OrderLineRequiredPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface OrderLine {
  id: string;
  itemId: string;
  variantId: string | null;
  quantity: number;
  width: number | null;
  unitPrice: string | null;
  item?: OrderLineItem;
  variant?: { id: string; code: string; name: string } | null;
  /** Müşterinin istediği özellikler — WO açılırken targetProperties önerisi olur. */
  requiredProperties?: OrderLineRequiredPropertyLink[];
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  branchId: string | null;
  currency: string;
  totalAmount: string | null;
  status: OrderStatus;
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
