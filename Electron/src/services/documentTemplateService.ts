// =============================================================================
// Belge tasarımcısı şablonları — client servisi (backend /api/document-templates)
// =============================================================================
// Yalnız belge ayarları ekranının "Varsayılan şablon" seçicisinin ihtiyacı (T1C);
// editör ve atama ekranı kendi uçlarını T2/T5'te ekler.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface TemplateContractView {
  docType: string;
}

export interface DocumentTemplateRow {
  id: string;
  docType: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  publishedVersionId: string | null;
  publishedVersion: { versionNo: number; publishedAt: string | null } | null;
}

export interface TemplateAssignments {
  defaults: Array<{ docType: string; template: { id: string; name: string } }>;
}

const base = "/api/document-templates";

export const documentTemplateService = {
  contracts: (): Promise<ApiResponse<TemplateContractView[]>> =>
    apiClient.get<ApiResponse<TemplateContractView[]>>(`${base}/contracts`).then((r) => r.data),

  list: (docType: string): Promise<ApiResponse<DocumentTemplateRow[]>> =>
    apiClient
      .get<ApiResponse<DocumentTemplateRow[]>>(base, { params: { docType, status: "ACTIVE" } })
      .then((r) => r.data),

  assignments: (): Promise<ApiResponse<TemplateAssignments>> =>
    apiClient.get<ApiResponse<TemplateAssignments>>(`${base}/assignments`).then((r) => r.data),

  /** `templateId: null` → varsayılan kaldırılır (Sistem tasarımı). */
  setDefault: (docType: string, templateId: string | null): Promise<ApiResponse<unknown>> =>
    apiClient.put<ApiResponse<unknown>>(`${base}/defaults/${docType}`, { templateId }).then((r) => r.data),
};
