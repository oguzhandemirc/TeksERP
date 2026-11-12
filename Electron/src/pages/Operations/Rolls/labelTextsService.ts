// =============================================================================
// TOP ETİKET AD/RENK/PARTİ DÜZELTMESİ (sevk edilene kadar) — servis + kilit yüklemi
// =============================================================================
// Uç `PATCH /api/rolls/:id/label-texts` (yol TAM yazılır: apiClient.baseURL `/api` içermez).
// Kilit kümesi backend `labelTextFixBlock`un AYNASI — yalnız düğmeyi kapatır; otorite sunucu (409).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface LabelTextsFixBody {
  labelItemName?: string;
  labelColorName?: string;
  labelBatchNo?: string;
  reason: string;
}

export interface LabelTextsFixResult {
  rollId: string;
  labelItemName: string | null;
  labelColorName: string | null;
  labelBatchNo: string | null;
  changed: boolean;
}

const SHIPPED = ["SHIPPED", "AT_SUBCONTRACTOR", "AT_KARTELA"];
const DEAD = ["TAMBUR_CONSUMED", "SUBCONTRACTOR_CONSUMED", "KARTELA_CONSUMED", "CANCELLED", "SCRAP", "RETURNED_FROM_SUBCONTRACTOR"];

/** null = düzeltilebilir; metin = düğme kapalı + gösterilecek neden. */
export function labelTextsLockReason(status: string): string | null {
  if (status === "SHIPPED") return "Top sevk edildi — etiket bilgisi artık düzeltilemez.";
  if (SHIPPED.includes(status)) return "Top fason/kartela sevkiyle dışarıda — etiket bilgisi düzeltilemez.";
  if (DEAD.includes(status)) return "Top tüketilmiş, iptal ya da fire edilmiş — etiketi yok.";
  return null;
}

const norm = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  return t === "" ? null : t;
};

/** Gövde: yalnız değişen alanlar; boşaltılan alan "" (sunucu temizler → etiket varsayılan ada döner). */
export function labelTextsFixBody(
  current: { labelItemName?: string | null; labelColorName?: string | null; labelBatchNo?: string | null },
  draft: { itemName: string; colorName: string; batchNo: string },
): Omit<LabelTextsFixBody, "reason"> {
  const body: Omit<LabelTextsFixBody, "reason"> = {};
  const item = norm(draft.itemName);
  const color = norm(draft.colorName);
  const batch = draft.batchNo.trim() === "" ? null : draft.batchNo.trim();
  if (item !== norm(current.labelItemName)) body.labelItemName = item ?? "";
  if (color !== norm(current.labelColorName)) body.labelColorName = color ?? "";
  if (batch !== (current.labelBatchNo?.trim() || null)) body.labelBatchNo = batch ?? "";
  return body;
}

export const labelTextsService = {
  fix: (rollId: string, body: LabelTextsFixBody): Promise<ApiResponse<LabelTextsFixResult>> =>
    apiClient.patch<ApiResponse<LabelTextsFixResult>>(`/api/rolls/${rollId}/label-texts`, body).then((r) => r.data),
};
