// Sarf stoğu (kuşak / kurşun şeridi) — okuma servisi. Yazım mal kabul ve üretim izinden doğar (backend).
import apiClient from "@/services/apiClient";

export type ConsumableMovementKind = "RECEIPT_IN" | "RECEIPT_CANCEL_OUT" | "CONSUMPTION_OUT" | "CONSUMPTION_REVERSAL_IN";

export interface ConsumableStockRow {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  balance: string;
  negative: boolean;
  isActive: boolean;
  /** Kartın asgari stoğu (kartın biriminde); boş = eşik yok. Eski sunucu göndermez. */
  minStockQty?: string | null;
  belowMinStock?: boolean;
}

export interface ConsumableStockList {
  enabled: boolean;
  rows: ConsumableStockRow[];
  /** `belowMinCount` faceted: "Asgari altı" filtresi seçilince listenin satır sayısı. */
  summary: { itemCount: number; negativeCount: number; belowMinCount?: number };
}

export interface ConsumableStockQuery {
  search?: string;
  belowMin?: boolean;
  /** Tek kalem (ürün penceresi) ya da CSV. */
  itemId?: string;
}

export interface ConsumableMovementRow {
  id: string;
  kind: ConsumableMovementKind;
  signedQty: string;
  reason: string | null;
  createdAt: string;
  reversed: boolean;
  isReversal: boolean;
  receipt: { id: string; receiptNo: string } | null;
  roll: { id: string; barcode: string } | null;
  workOrder: { id: string; workOrderNumber: string } | null;
  operationType: string | null;
}

export interface ConsumableMovementPage {
  item: { id: string; name: string; unit: string };
  rows: ConsumableMovementRow[];
  nextCursor: string | null;
}

export const CONSUMABLE_KIND_LABEL: Record<ConsumableMovementKind, string> = {
  RECEIPT_IN: "Mal kabul girişi",
  RECEIPT_CANCEL_OUT: "Mal kabul iptali",
  CONSUMPTION_OUT: "Üretim tüketimi",
  CONSUMPTION_REVERSAL_IN: "Tüketim geri alındı",
};

export async function listConsumableStock(q: ConsumableStockQuery = {}): Promise<ConsumableStockList> {
  const search = q.search?.trim();
  const params = { ...(search ? { search } : {}), ...(q.belowMin ? { belowMin: "1" } : {}), ...(q.itemId ? { itemId: q.itemId } : {}) };
  const res = await apiClient.get("/api/consumable-stock", { params });
  return res.data.data as ConsumableStockList;
}

export async function listConsumableMovements(itemId: string, cursor?: string): Promise<ConsumableMovementPage> {
  const res = await apiClient.get(`/api/consumable-stock/${itemId}/movements`, { params: cursor ? { cursor } : {} });
  return res.data.data as ConsumableMovementPage;
}
