import type { RollStatus, RollOperationType } from "@/types/enums";

export interface RollColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface RollItem {
  id: string;
  code: string;
  name: string;
}

export interface RollPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface Roll {
  id: string;
  /** Açık kumaş Roll'larında null — fiziksel etiket basılmaz. */
  barcode: string | null;
  itemId: string;
  colorId: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  status: RollStatus;
  qualityGrade: string;
  entrySource: string;
  parentRollId: string | null;
  /** Açık kumaş Roll'lar için fason kabul referansı. */
  parentReceiptId: string | null;
  packageId: string | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  packagingDate: string | null;
  item?: RollItem;
  color?: RollColor | null;
  /** Roll'a bindirilmiş özellikler (Fason Kabul / Tambur kopyalar). */
  properties?: RollPropertyLink[];
  /** Per-roll operasyon logu. Sadece detay endpoint'inden gelir. */
  operations?: RollOperationLogEntry[];
  /** Değişebilir etiket — top hangi siparişe/müşteriye etiketli (null = stok etiketli). */
  targetOrderLineId?: string | null;
  targetOrderLine?: RollTargetOrderLine | null;
  /** Etiket değişti → fiziksel etiket tamburda yeniden basılmalı. */
  needsReprint?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RollTargetOrderLine {
  id: string;
  customerItemName: string | null;
  customerColorName: string | null;
  order: {
    id: string;
    orderNumber: string;
    customer: { id: string; code: string; name: string };
    branch: { id: string; name: string } | null;
  };
}

export interface RollOperationLogEntry {
  id: string;
  operationType: RollOperationType;
  createdAt: string;
  operator: { id: string; fullName: string; username: string } | null;
}

export interface RollMovement {
  id: string;
  rollId: string;
  fromStepId: string | null;
  toStepId: string | null;
  movedAt: string;
  notes: string | null;
  fromStep?: { station?: { name: string } };
  toStep?: { station?: { name: string } };
}
