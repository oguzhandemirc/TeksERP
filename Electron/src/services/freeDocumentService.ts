// =============================================================================
// Serbest Belge — client servisi (backend /api/free-documents)
// =============================================================================

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DocumentConfig } from "@/services/documentConfig";

export interface FreeDocumentRow {
  id: string;
  documentNo: string;
  title: string;
  recipient: string | null;
  isActive: boolean;
  updatedAt: string;
  createdAt: string;
}
export interface FreeDocument extends FreeDocumentRow {
  body: string;
  config: DocumentConfig;
}

const base = "/api/free-documents";

export const freeDocumentService = {
  list: (withInactive = false): Promise<ApiResponse<FreeDocumentRow[]>> =>
    apiClient.get<ApiResponse<FreeDocumentRow[]>>(base, { params: withInactive ? { withInactive: "true" } : {} }).then((r) => r.data),

  get: (id: string): Promise<ApiResponse<FreeDocument>> =>
    apiClient.get<ApiResponse<FreeDocument>>(`${base}/${id}`).then((r) => r.data),

  create: (input: { title: string; recipient?: string | null; body?: string; config?: DocumentConfig }): Promise<ApiResponse<FreeDocument>> =>
    apiClient.post<ApiResponse<FreeDocument>>(base, input).then((r) => r.data),

  update: (id: string, input: { title?: string; recipient?: string | null; body?: string; config?: DocumentConfig; isActive?: boolean }): Promise<ApiResponse<FreeDocument>> =>
    apiClient.put<ApiResponse<FreeDocument>>(`${base}/${id}`, input).then((r) => r.data),

  deactivate: (id: string): Promise<ApiResponse<FreeDocument>> =>
    apiClient.delete<ApiResponse<FreeDocument>>(`${base}/${id}`).then((r) => r.data),

  /** Baskı-hazır HTML (text/html). printNote → tek seferlik not. */
  getHtml: (id: string, printNote?: string): Promise<string> =>
    apiClient
      .get<string>(`${base}/${id}/html`, {
        params: printNote?.trim() ? { printNote: printNote.trim() } : {},
        responseType: "text",
        headers: { Accept: "text/html" },
      })
      .then((r) => r.data),
};
