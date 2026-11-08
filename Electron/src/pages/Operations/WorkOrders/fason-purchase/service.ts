// Fason kabulünden ALIŞ faturası taslağı (F6) — backend `services/subcontractor/types.ts` aynası. Hesap SUNUCUDA
// (kalem = hizmet kartı, miktar = kabul metresi/kg, fiyat sevk tarihindeki tarife); panel önizler ve onaylatır.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface SubcontractorPurchaseDraftLine {
  serviceItemId: string | null;
  description: string;
  qty: string;
  unit: "METER" | "KG";
  unitPrice: string;
  currency: string;
  finishingRateId: string | null;
  vatRate: number;
  withholdingRate: number;
}

export interface SubcontractorPurchaseDraftPreview {
  receiptId: string;
  receiptNo: string;
  subcontractor: { id: string; name: string };
  supplierCustomerId: string | null;
  currency: string;
  lines: SubcontractorPurchaseDraftLine[];
  subtotal: string;
  existingInvoice: { id: string; docNo: string; status: string } | null;
  warnings: string[];
}

export interface FasonReceiptRef {
  id: string;
  receiptNo: string;
  receivedAt: string;
}

const BASE = "/api/finance/invoices/from-subcontractor-receipt";

/** İş emrinin aktif kabulleri (`workorder:read`); sevk satırının kabul numaralarıyla eşlenir. */
export async function listWorkOrderReceipts(workOrderId: string): Promise<FasonReceiptRef[]> {
  const res = await apiClient.get<ApiResponse<FasonReceiptRef[]>>("/api/subcontractor/receipts", { params: { workOrderId, pageSize: "100" } });
  return res.data.data ?? [];
}

/** Önizleme hatası (bağsız firma, iptal kabul…) diyalogda satır içinde söylenir — toast çift olmasın. */
export async function previewPurchaseDraft(receiptId: string): Promise<SubcontractorPurchaseDraftPreview> {
  const res = await apiClient.get<ApiResponse<SubcontractorPurchaseDraftPreview>>(`${BASE}/${receiptId}/preview`, { suppressErrorToast: true });
  return res.data.data;
}

export async function createPurchaseDraft(receiptId: string): Promise<{ id: string; docNo?: string | null }> {
  const res = await apiClient.post<ApiResponse<{ id: string; docNo?: string | null }>>(`${BASE}/${receiptId}`, {});
  return res.data.data;
}

export const PURCHASE_UNIT_LABEL: Record<string, string> = { METER: "m", KG: "kg" };

/** Taslak oluşturulabilir mi: satır var, fatura yok, tedarikçi kartı bağlı. */
export function canCreatePurchaseDraft(p: SubcontractorPurchaseDraftPreview | undefined): boolean {
  return Boolean(p && p.lines.length > 0 && !p.existingInvoice && p.supplierCustomerId);
}
