// K28 belge fotoğrafı saklama — backend aynaları (`DocumentScanContentState`, `PhotoRetentionMode`, İE "Geldiği belge").
import type { DocumentScanInfo, NoteStatus } from "./types";

export type DocumentScanContentState = "FULL" | "REDUCED" | "PURGED";
export type PhotoRetentionMode = "FULL" | "SHRINK_ON_APPROVAL" | "DELETE_ON_APPROVAL" | "DELETE_ON_DISPATCH";

/** Tarama künyesinin bayt durumu; eski backend göndermez (undefined = TAM). */
export interface ScanContentFields {
  contentState?: DocumentScanContentState;
  contentStateAt?: string | null;
}

/** `GET /api/gelen-belge/is-emirleri/:id/belgeler` — backend `gelen-belge-ie-kaynak.service.ts` aynası. */
export interface WorkOrderSourceNote {
  id: string;
  noteNo: string;
  status: NoteStatus;
  senderDocNo: string | null;
  scans: Array<Pick<DocumentScanInfo, "id" | "pageNo" | "regionNo" | "mimeType"> & Required<ScanContentFields>>;
}
