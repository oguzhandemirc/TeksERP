import type { RollStatus, RollOperationType } from "@/types/enums";

export interface RollItemColor {
  id: string;
  code: string;
  name: string;
  hex: string | null;
}

export interface RollItemProperty {
  property?: { id: string; code: string; name: string };
}

export interface RollItem {
  id: string;
  code: string;
  name: string;
  isDerived?: boolean;
  baseItem?: { id: string; code: string; name: string } | null;
  color?: RollItemColor | null;
}

export interface RollPropertyLink {
  propertyId: string;
  property: { id: string; code: string; name: string };
}

export interface Roll {
  id: string;
  barcode: string;
  itemId: string;
  variantId: string | null;
  ownerCustomerId: string | null;
  customerDescription: string | null;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  status: RollStatus;
  qualityGrade: string;
  entrySource: string;
  parentRollId: string | null;
  packageId: string | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  packagingDate: string | null;
  item?: RollItem;
  variant?: { id: string; code: string; name: string } | null;
  ownerCustomer?: { id: string; code: string; name: string } | null;
  /** Roll'a bindirilmiş özellikler (Tambur'da WO.targetProperties'tan kopyalanır). */
  properties?: RollPropertyLink[];
  /** Per-roll operasyon logu (KURSUN_APPLIED, QC2_COMPLETED, ...). Sadece detay endpoint'inden gelir. */
  operations?: RollOperationLogEntry[];
  createdAt: string;
  updatedAt: string;
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

