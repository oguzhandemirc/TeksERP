// =============================================================================
// AÇIK SİPARİŞ KALEMLERİ — `GET /api/orders/order-lines/available` (mevcut uç; cursor kipi)
// =============================================================================
// Dokuma işi ↔ sipariş satırı seçicisinin kaynağı (Z2, 2026-09-18). `itemId` verilir (kumaş
// seçilmeden liste yok); `openQty = quantity − shippedQty` sunucuda; ölçülmeyen birimde null.
// Decimal alanlar JSON'da METİN gelebilir — okuyan `num()` ile çevirir.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { CursorPaginatedResponse } from "@/types/api";

export interface AvailableOrderLine {
  lineId: string;
  itemId: string;
  orderId: string;
  orderNumber: string;
  deadline: string | null;
  customerId: string;
  customerName: string;
  branchName: string | null;
  itemCode: string;
  itemName: string;
  customerItemName: string | null;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  customerColorName: string | null;
  width: number | string | null;
  quantity: number | string;
  openQty: number | string | null;
  inProduction: number | string;
  netOpenQty: number | string | null;
  measured: boolean;
  hasWorkOrder: boolean;
}

export interface AvailableLinesQuery {
  itemId: string;
  colorId?: string | null;
  search?: string;
  cursor?: string | null;
  limit?: number;
}

/** Sunucu Decimal'i metin de gönderebilir; boş/geçersiz → null. */
export function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function listAvailableOrderLines(q: AvailableLinesQuery): Promise<CursorPaginatedResponse<AvailableOrderLine>> {
  const sp = new URLSearchParams();
  sp.set("itemId", q.itemId);
  if (q.colorId) sp.set("colorId", q.colorId);
  if (q.search) sp.set("search", q.search);
  if (q.cursor) sp.set("cursor", q.cursor);
  sp.set("limit", String(q.limit ?? 100));
  return apiClient.get<CursorPaginatedResponse<AvailableOrderLine>>(`/api/orders/order-lines/available?${sp.toString()}`).then((r) => r.data);
}
