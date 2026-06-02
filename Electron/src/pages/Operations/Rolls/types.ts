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
  /** Topun ÜSTÜNDEKİ son basılan etiketin snapshot'ı (null = stok / müşteri etiketi yok).
   *  BAĞ DEĞİL — yalnız bilgi; baskı/yönlendir anında yazılır. Detay endpoint'inden gelir. */
  lastLabelSnapshot?: RollLabelSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface RollLabelSnapshot {
  customerId: string | null;
  customerName: string | null;
  orderNumber: string | null;
  itemName: string | null;
  colorName: string | null;
  printedAt: string;
  operatorId: string | null;
  operatorName: string | null;
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
