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
  _count: { rolls: number };
}

export interface GoodsReceiptLineInput {
  itemId: string;
  colorId?: string | null;
  initialQty: number;
  width?: number | null;
  weightKg?: number | null;
  /** Kat — opsiyonel, katalogdan (backend kanonikleştirir). */
  foldType?: string | null;
  propertyIds?: string[];
  clientToken?: string;
}

export interface GoodsReceiptDetail {
  id: string;
  receiptNo: string;
  status: "ACTIVE" | "CANCELLED";
  deliveryNoteNo: string | null;
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
    width: string | number | null;
    item: { id: string; name: string };
    color: { id: string; name: string } | null;
  }>;
  totals: { rollCount: number; totalQty: number };
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
