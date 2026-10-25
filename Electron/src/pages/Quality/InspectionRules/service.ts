// K4P-TANIM — 4 puan kural setleri (`/api/four-point-rules`). Bant doğrulaması SUNUCUDADIR (`validateBands`);
// panel yalnız alan boşluğunu söyler, bant mantığının aynasını tutmaz.
import axios from "axios";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { apiErrorText } from "@/lib/api-error";

export type RuleScope = "FACTORY" | "CUSTOMER";
export type ScoreUnit = "M2" | "YD2";
export type RunningCap = "NONE" | "METER" | "YARD";

export interface RuleBand {
  sortOrder: number;
  maxScore: string | number | null;
  label: string;
  accepted: boolean;
  qualityGradeId: string | null;
}
export interface RuleSet {
  id: string; name: string; scope: RuleScope; customerId: string | null; itemId: string | null;
  unit: ScoreUnit; runningCap: RunningCap; isActive: boolean; createdAt: string; updatedAt: string;
  bands: RuleBand[];
  customer: { id: string; name: string } | null;
  item: { id: string; code: string; name: string } | null;
}
export interface RuleSetBody {
  name: string; unit: ScoreUnit; runningCap: RunningCap;
  bands: Array<{ sortOrder: number; maxScore: string | null; label: string; accepted: boolean; qualityGradeId?: string | null }>;
}
export type RuleSetCreateBody = RuleSetBody & { scope: RuleScope; customerId?: string | null; itemId?: string | null };

// Form kendi hata kutusunu çizer; genel toast ikinci kez basmasın.
const quiet = { suppressErrorToast: true } as const;

export const ruleSetService = {
  list: (includeInactive: boolean) =>
    apiClient.get<ApiResponse<RuleSet[]>>("/api/four-point-rules", { params: includeInactive ? { includeInactive: "1" } : {} }).then((r) => r.data.data),
  create: (body: RuleSetCreateBody) => apiClient.post<ApiResponse<RuleSet>>("/api/four-point-rules", body, quiet).then((r) => r.data.data),
  update: (id: string, body: RuleSetBody) => apiClient.put<ApiResponse<RuleSet>>(`/api/four-point-rules/${id}`, body, quiet).then((r) => r.data.data),
  setActive: (id: string, isActive: boolean) =>
    apiClient.post<ApiResponse<RuleSet>>(`/api/four-point-rules/${id}/active`, { isActive }, quiet).then((r) => r.data.data),
};

/** Sunucu hatasının ekrana yazılacak cümlesi; tek aktif set çakışması kapsama göre açıklanır. */
export function ruleSetErrorText(error: unknown, scope: RuleScope): string {
  const code = axios.isAxiosError(error) ? (error.response?.data as { details?: { code?: string } } | undefined)?.details?.code : undefined;
  if (code === "FOUR_POINT_RULE_ACTIVE_EXISTS") {
    return scope === "FACTORY"
      ? "Aktif bir fabrika varsayılanı zaten var. Yenisini açmak için önce mevcut fabrika setini pasife alın ya da onu düzenleyin."
      : "Bu müşteri (ve ürün) için aktif bir kural seti zaten var. Önce onu pasife alın ya da onu düzenleyin.";
  }
  return apiErrorText(error, "Kural seti kaydedilemedi.");
}
