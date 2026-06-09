// =============================================================================
// Resmi belge defteri (PrintedDocument) — client servisi + tipleri
// =============================================================================
// Backend /api/printed-documents ile konuşur. Üç irsaliye/çeki belgesi ortak:
// güncel belge (snapshot dahil) + versiyon geçmişi + gerekçeli revizyon.
// Snapshot, freeze anında DONMUŞ içeriği + şablon override'ını + firma künyesini
// taşır; belge bileşeni canlı feature-flag yerine bu donmuş ayardan render eder.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CompanyLetterhead, DocumentConfig } from "@/services/documentConfig";

export type PrintedDocType =
  | "SHIPMENT_DISPATCH"
  | "SUBCONTRACTOR_DISPATCH"
  | "KARTELA_DISPATCH";

export type PrintedDocStatus = "ACTIVE" | "SUPERSEDED" | "VOIDED";

/** Freeze anında donan snapshot zarfı. `doc` belge-tipine özel payload. */
export interface PrintedDocSnapshot<TDoc = Record<string, unknown>> {
  schemaVersion: 1;
  frozenAt: string;
  company: { name: string; letterhead: CompanyLetterhead };
  /** Ham (kısmi) şablon override — client resolveDocConfig ile çözer. */
  docConfigOverride: DocumentConfig | null;
  doc: TDoc;
}

/** Tam belge kaydı (snapshot dahil) — getCurrent / getVersion döner. */
export interface PrintedDocument<TDoc = Record<string, unknown>> {
  id: string;
  docType: PrintedDocType;
  sourceId: string;
  version: number;
  status: PrintedDocStatus;
  documentNo: string;
  snapshot: PrintedDocSnapshot<TDoc>;
  reissueReason: string | null;
  supersededAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconstructed: boolean;
  printedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Hafif versiyon satırı (snapshot içeriği olmadan) — geçmiş listesi. */
export interface PrintedDocVersion {
  id: string;
  version: number;
  status: PrintedDocStatus;
  documentNo: string;
  reissueReason: string | null;
  supersededAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  reconstructed: boolean;
  createdAt: string;
  printedBy: { id: string; fullName: string } | null;
}

const base = "/api/printed-documents";

export const printedDocumentService = {
  /** Güncel belge (en yüksek versiyon). data=null → kaynak TASLAK aşamasında. */
  getCurrent: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
  ): Promise<ApiResponse<PrintedDocument<TDoc> | null>> =>
    apiClient
      .get<ApiResponse<PrintedDocument<TDoc> | null>>(
        `${base}/${docType}/${sourceId}/current`,
      )
      .then((r) => r.data),

  /** Versiyon geçmişi (yeniden eskiye). */
  listVersions: (
    docType: PrintedDocType,
    sourceId: string,
  ): Promise<ApiResponse<PrintedDocVersion[]>> =>
    apiClient
      .get<ApiResponse<PrintedDocVersion[]>>(
        `${base}/${docType}/${sourceId}/versions`,
      )
      .then((r) => r.data),

  /** Tek versiyonu snapshot'ıyla getir. */
  getVersion: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
    version: number,
  ): Promise<ApiResponse<PrintedDocument<TDoc>>> =>
    apiClient
      .get<ApiResponse<PrintedDocument<TDoc>>>(
        `${base}/${docType}/${sourceId}/versions/${version}`,
      )
      .then((r) => r.data),

  /** Gerekçeli revizyon → yeni versiyon (eskisi SUPERSEDED). */
  reissue: <TDoc = Record<string, unknown>>(
    docType: PrintedDocType,
    sourceId: string,
    reason: string,
  ): Promise<ApiResponse<PrintedDocument<TDoc>>> =>
    apiClient
      .post<ApiResponse<PrintedDocument<TDoc>>>(
        `${base}/${docType}/${sourceId}/reissue`,
        { reason },
      )
      .then((r) => r.data),
};
