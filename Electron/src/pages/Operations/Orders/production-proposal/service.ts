// Üretim önerisi istemcisi (SY-M3). Hata toast'ı BASTIRILIR: 409 cümlesi diyalogda kalır (kullanıcı yeniler).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ProductionProposal, ProposalApplyBody, ProposalApplyResult } from "./types";

const base = (orderId: string) => `/api/orders/${orderId}/production-proposal`;

export const productionProposalService = {
  preview: (orderId: string): Promise<ProductionProposal> =>
    apiClient.post<ApiResponse<ProductionProposal>>(`${base(orderId)}/preview`, {}, { suppressErrorToast: true }).then((r) => r.data.data),
  apply: (orderId: string, body: ProposalApplyBody): Promise<ApiResponse<ProposalApplyResult> & { idempotentReplay?: boolean }> =>
    apiClient.post<ApiResponse<ProposalApplyResult> & { idempotentReplay?: boolean }>(`${base(orderId)}/apply`, body, { suppressErrorToast: true }).then((r) => r.data),
};
