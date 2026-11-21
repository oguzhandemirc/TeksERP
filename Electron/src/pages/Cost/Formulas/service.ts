// Ek maliyet formülleri (`/api/cost/formulas`, SY-C1). Değişim YENİ sürüm doğurur, eskisi damgalanır;
// kayıtlı standart maliyet sürümleri yazıldıkları formülle kalır. Gövde açık alan listesiyle kurulur.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";

export interface CostFormula {
  id: string; code: string; name: string; expression: string; currency: Currency; sortOrder: number; versionNo: number;
  note: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string;
  createdBy: { id: string; fullName: string } | null;
}

export interface CostFormulaVariable { name: string; label: string; unit: string; bagli: boolean; sample: string }

/** `sortOrder` tam sayı METNİ gider (sunucu 0–999 doğrular; istemcide sayıya çevirme yok). */
export interface CostFormulaInput { code: string; name: string; expression: string; currency: Currency; sortOrder: string; note: string | null }

export interface CostFormulaPreview { sonuc: string | null; hata: string | null; degiskenler: string[] }

export function buildCostFormulaBody(i: CostFormulaInput): CostFormulaInput {
  return { code: i.code, name: i.name, expression: i.expression, currency: i.currency, sortOrder: i.sortOrder, note: i.note };
}

const BASE = "/api/cost/formulas";

export const costFormulaService = {
  listActive: async () => (await apiClient.get<ApiResponse<CostFormula[]>>(BASE)).data.data,
  history: async (code: string) => (await apiClient.get<ApiResponse<CostFormula[]>>(BASE, { params: { code, includeRevoked: "1" } })).data.data,
  variables: async () => (await apiClient.get<ApiResponse<CostFormulaVariable[]>>(`${BASE}/variables`)).data.data,
  /** Hiçbir şey yazmaz — canlı önizleme (sunucu notu: OTOMATIK_YAZIMLAR beyanlı). */
  preview: async (expression: string) => (await apiClient.post<ApiResponse<CostFormulaPreview>>(`${BASE}/preview`, { expression }, { suppressErrorToast: true })).data.data,
  create: async (i: CostFormulaInput) => (await apiClient.post<ApiResponse<CostFormula>>(BASE, buildCostFormulaBody(i))).data,
  change: async (id: string, i: CostFormulaInput) => (await apiClient.post<ApiResponse<CostFormula & { wrote: boolean }>>(`${BASE}/${id}/change`, buildCostFormulaBody(i))).data,
  revoke: async (id: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${id}/revoke`, {})).data,
};
