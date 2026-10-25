// =============================================================================
// Belge tasarımcısı şablonları — client servisi (backend /api/document-templates)
// =============================================================================
// Varsayılan şablon seçicisi (T1C) + tasarımcının sözleşme/sistem okuması (T3);
// kayıt, sürüm ve atama ekranı kendi uçlarını T5'te ekler.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ContractView } from "@/pages/Definitions/DocumentDesigner/binding/contract";

export interface TemplateContractView {
  docType: string;
  hedef?: "musteri" | "ic";
  contractVersion?: number;
  copyable?: boolean;
}

/** `GET /system/:docType` — Sistem eşleniği + kopya anında dondurulacak etkin ayar (P-d). */
export interface SystemTemplateView {
  docType: string;
  copyable: boolean;
  settings: Record<string, unknown>;
  internalFields: string[];
  warnings: string[];
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

  contract: (docType: string): Promise<ApiResponse<ContractView>> =>
    apiClient.get<ApiResponse<ContractView>>(`${base}/contracts/${encodeURIComponent(docType)}`).then((r) => r.data),

  system: (docType: string): Promise<ApiResponse<SystemTemplateView>> =>
    apiClient.get<ApiResponse<SystemTemplateView>>(`${base}/system/${encodeURIComponent(docType)}`).then((r) => r.data),

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
