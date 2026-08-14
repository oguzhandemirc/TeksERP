import apiClient from "@/services/apiClient";

export interface GoodsReceiptListRow {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
  createdAt: string;
  cancelledAt: string | null;
  warehouse: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  /** `yarnMovements` Sınıf 5 ile geldi (2026-08-14) — eski backend'e karşı
   *  opsiyonel okunur (`?? 0`), yoksa liste kumaş sayacına düşer. */
  _count: { rolls: number; yarnMovements?: number };
}

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  width?: number | null;
  weightKg?: number | null;
  /** Kat — opsiyonel, katalogdan (backend kanonikleştirir). */
  foldType?: string | null;
  /** Satın alma birim fiyatı — fişin para biriminde (opsiyonel). */
  unitPrice?: number | null;
  propertyIds?: string[];
  clientToken?: string;
}

// ── SINIF 5 (2026-08-14): fişin satırları backend'de TEK assembler'dan gelir
// (`assembleReceiptLines` → `lines` union'ı). Panel iplik yüzeyini `lines`ten
// okur; `rolls` (kumaş tablosu) eski sözleşmesiyle AYNEN durur.

/** Assembler union'ının KUMAŞ satırı (backend `ReceiptFabricLine`). */
export interface ReceiptDetailFabricLine {
  kind: "FABRIC";
  id: string;
  barcode: string | null;
  status: string;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  colorName: string | null;
  qty: string | number;
  initialQty: string | number;
  purchasePrice: string | number | null;
}

/** Assembler union'ının İPLİK satırı (backend `ReceiptYarnLine`).
 *  `movementKind !== "IN"` = fiş iptalinin ters kaydı → soluk satır + "İptal"
 *  rozeti (defter "ne oldu"yu anlatır, satır gizlenmez). */
export interface ReceiptDetailYarnLine {
  kind: "YARN";
  id: string;
  movementKind: "IN" | "OUT" | "ADJUST_IN" | "ADJUST_OUT";
  itemId: string;
  itemName: string;
  itemCode: string | null;
  /** POZİTİF kg — yönü `movementKind` söyler. Decimal JSON'da string gelir. */
  qtyKg: string | number;
  unitPrice: string | number | null;
  reason: string | null;
  createdAt: string;
}

export type ReceiptDetailLine = ReceiptDetailFabricLine | ReceiptDetailYarnLine;

export interface GoodsReceiptDetail {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
  currency: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes: string | null;
  createdAt: string;
  warehouse: { id: string; code: string; name: string };
  supplier: { id: string; code: string; name: string } | null;
  createdBy: { fullName: string | null; username: string } | null;
  rolls: Array<{
    id: string;
    barcode: string | null;
    status: string;
    currentQty: string | number;
    purchasePrice?: string | number | null;
    width: string | number | null;
    item: { id: string; name: string };
    color: { id: string; name: string } | null;
  }>;
  /** Union satırlar (önce kumaş, sonra iplik) — iplik yüzeyinin TEK kaynağı.
   *  Eski backend'de alan yoktur → `?? []` ile okunur. */
  lines?: ReceiptDetailLine[];
  /** İplik alanları Sınıf 5 ile geldi — eski backend'e karşı opsiyonel. */
  totals: { rollCount: number; totalQty: number; yarnLineCount?: number; totalYarnKg?: number };
  /** Atlanan satırlar — SEBEBİYLE döner (sessiz yutma yok). */
  failed?: Array<{ index: number; itemId: string; reason: string }>;
}

export async function listGoodsReceipts(params: { page: number; pageSize: number; search?: string }) {
  const res = await apiClient.get("/api/goods-receipts", {
    params: { page: params.page, pageSize: params.pageSize, ...(params.search ? { search: params.search } : {}) },
  });
  return res.data as { data: GoodsReceiptListRow[]; pagination: { total: number; totalPages: number } };
}

export async function getGoodsReceipt(id: string): Promise<GoodsReceiptDetail> {
  const res = await apiClient.get(`/api/goods-receipts/${id}`);
  return res.data.data as GoodsReceiptDetail;
}

export async function createGoodsReceipt(body: {
  warehouseId: string;
  supplierId?: string | null;
  deliveryNoteNo?: string | null;
  currency?: "TRY" | "USD" | "EUR" | "GBP" | "RUB";
  notes?: string | null;
  clientToken?: string;
  lines?: GoodsReceiptLineInput[];
}): Promise<{ data: GoodsReceiptDetail; message?: string }> {
  const res = await apiClient.post("/api/goods-receipts", body);
  return res.data;
}

export async function cancelGoodsReceipt(id: string, reason?: string) {
  const res = await apiClient.post(`/api/goods-receipts/${id}/cancel`, { reason });
  return res.data;
}

/**
 * Fişten alış faturası taslağı üretir (backend gruplar: ürün+renk+FİYAT).
 * ⚠️ Yol TAM — apiClient.baseURL "/api" içermez.
 */
export async function createInvoiceFromReceipt(receiptId: string) {
  const res = await apiClient.post(`/api/finance/invoices/from-goods-receipt/${receiptId}`);
  return res.data as { data: { id: string; docNo: string }; message?: string };
}
