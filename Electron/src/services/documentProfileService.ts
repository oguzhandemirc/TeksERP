// =============================================================================
// Belge şablon profilleri — client servisi (backend /api/document-profiles)
// =============================================================================
// Profil = genel Belge Şablonları ayarının üzerine binen adlandırılmış override
// paketi ({ [belgeKey]: DocumentConfig }). Müşteri/fason kartına atanır; belge
// freeze anında backend çözüm zincirinde merge edilir.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DocumentsConfig } from "@/services/documentConfig";

export interface DocumentProfileRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
  _count?: { customers: number; subcontractors: number };
}

export interface DocumentProfile extends DocumentProfileRow {
  config: DocumentsConfig;
  createdAt: string;
}

const base = "/api/document-profiles";

export const documentProfileService = {
  list: (withInactive = false): Promise<ApiResponse<DocumentProfileRow[]>> =>
    apiClient
      .get<ApiResponse<DocumentProfileRow[]>>(base, {
        params: withInactive ? { withInactive: "true" } : {},
      })
      .then((r) => r.data),

  get: (id: string): Promise<ApiResponse<DocumentProfile>> =>
    apiClient.get<ApiResponse<DocumentProfile>>(`${base}/${id}`).then((r) => r.data),

  create: (input: {
    name: string;
    description?: string | null;
    config?: DocumentsConfig;
  }): Promise<ApiResponse<DocumentProfile>> =>
    apiClient.post<ApiResponse<DocumentProfile>>(base, input).then((r) => r.data),

  update: (
    id: string,
    input: {
      name?: string;
      description?: string | null;
      config?: DocumentsConfig;
      isActive?: boolean;
    },
  ): Promise<ApiResponse<DocumentProfile>> =>
    apiClient.put<ApiResponse<DocumentProfile>>(`${base}/${id}`, input).then((r) => r.data),

  deactivate: (id: string): Promise<ApiResponse<DocumentProfile>> =>
    apiClient.delete<ApiResponse<DocumentProfile>>(`${base}/${id}`).then((r) => r.data),
};
