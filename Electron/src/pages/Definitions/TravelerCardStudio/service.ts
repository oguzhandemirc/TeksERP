import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { TravelerCardConfig } from "@/services/featureFlagService";
import type { TravelerTemplate, TravelerTemplateMode, TemplateInspection } from "./types";

const BASE = "/api/traveler-templates";

export interface TemplatePayload {
  name?: string;
  mode?: TravelerTemplateMode;
  config?: TravelerCardConfig;
  html?: string | null;
  isActive?: boolean;
}

export const travelerTemplateService = {
  list: () => apiClient.get<ApiResponse<TravelerTemplate[]>>(BASE).then((r) => r.data.data),

  create: (payload: TemplatePayload) =>
    apiClient.post<ApiResponse<TravelerTemplate>>(BASE, payload).then((r) => r.data.data),

  update: (id: string, payload: TemplatePayload) =>
    apiClient.patch<ApiResponse<TravelerTemplate>>(`${BASE}/${id}`, payload).then((r) => r.data.data),

  remove: (id: string) => apiClient.delete<ApiResponse<null>>(`${BASE}/${id}`).then((r) => r.data),

  setDefault: (id: string) =>
    apiClient.post<ApiResponse<TravelerTemplate>>(`${BASE}/${id}/default`, {}).then((r) => r.data.data),

  /** Varsayılanlığı kaldır → yerleşik kart basılır (şablon silinmez). */
  clearDefault: () => apiClient.delete<ApiResponse<null>>(`${BASE}/default`).then((r) => r.data),

  /** Uzman HTML ön-denetimi — neyin kesileceği + bilinmeyen alanlar (UYARI). */
  inspect: (html: string) =>
    apiClient
      .post<ApiResponse<TemplateInspection>>(`${BASE}/inspect`, { html })
      .then((r) => r.data.data),

  /**
   * KAYDEDİLMEMİŞ taslağın önizlemesi — gerçek baskı yolunu kullanır
   * (`renderTravelerCard` dağıtıcısı), yani önizleme = çıktı.
   */
  previewHtml: (config: TravelerCardConfig, template?: { mode: TravelerTemplateMode; html?: string | null; name?: string }) =>
    apiClient
      .post<string>(
        "/api/traveler-cards/sample-html",
        { config, template },
        { responseType: "text", headers: { Accept: "text/html" } },
      )
      .then((r) => r.data),
};
