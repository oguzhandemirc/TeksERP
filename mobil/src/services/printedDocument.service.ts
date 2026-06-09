// =============================================================================
// Resmi belge defteri (PrintedDocument) — mobil client. Backend
// /api/printed-documents ile konuşur. Şimdilik yalnız okuma: sevk irsaliyesinin
// donmuş güncel versiyonunu çeker (mobil revizyon/versiyon-geçmişi yok; o
// Electron'da). data=null → kaynak henüz TASLAK aşamasında (donmuş belge yok).
// =============================================================================

import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { CompanyLetterhead, DocumentConfig } from './documentConfig';

export type PrintedDocType =
  | 'SHIPMENT_DISPATCH'
  | 'SUBCONTRACTOR_DISPATCH'
  | 'KARTELA_DISPATCH';

export type PrintedDocStatus = 'ACTIVE' | 'SUPERSEDED' | 'VOIDED';

export interface PrintedDocSnapshot<TDoc = Record<string, unknown>> {
  schemaVersion: 1;
  frozenAt: string;
  company: { name: string; letterhead: CompanyLetterhead };
  docConfigOverride: DocumentConfig | null;
  doc: TDoc;
}

export interface PrintedDocument<TDoc = Record<string, unknown>> {
  id: string;
  docType: PrintedDocType;
  sourceId: string;
  version: number;
  status: PrintedDocStatus;
  documentNo: string;
  snapshot: PrintedDocSnapshot<TDoc>;
  reissueReason: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconstructed: boolean;
  createdAt: string;
}

export const printedDocumentService = {
  getCurrent: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
  ): Promise<ApiResponse<PrintedDocument<TDoc> | null>> =>
    apiClient
      .get<ApiResponse<PrintedDocument<TDoc> | null>>(
        `/printed-documents/${docType}/${sourceId}/current`,
      )
      .then((r) => r.data),
};
