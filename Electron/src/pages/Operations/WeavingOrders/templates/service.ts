// Özel dokuma iş emri şablonları API istemcisi. ⚠️ Yol TAM yazılır (`apiClient.baseURL` `/api` İÇERMEZ).
// Dokuma ucu çağıran istemci dosyası olarak `test_dokuma_regime_gate §7` allowlist'inde ADIYLA durur.
import apiClient from "@/services/apiClient";
import type { ApiResponse, PaginatedResponse } from "@/types/api";
import type { WeavingOrderTemplate } from "./types";

const BASE = "/api/weaving-order-templates";
export const WEAVING_TEMPLATES_KEY = ["weaving-order-templates"] as const;

export const weavingTemplateService = {
  /** Etkin şablonlar; sıra istemcide (`orderTemplates`) — liste kısa (elle tanımlanan kısayollar). */
  listActive: () =>
    apiClient
      .get<PaginatedResponse<WeavingOrderTemplate>>(`${BASE}?filter[isActive]=true&pageSize=200`)
      .then((r) => r.data.data ?? []),
  create: (body: Record<string, unknown>) => apiClient.post<ApiResponse<WeavingOrderTemplate>>(BASE, body).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<ApiResponse<WeavingOrderTemplate>>(`${BASE}/${id}`, body).then((r) => r.data),
  deactivate: (id: string) => apiClient.delete<ApiResponse<WeavingOrderTemplate>>(`${BASE}/${id}`).then((r) => r.data),
};
