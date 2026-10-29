// =============================================================================
// Gelen belge (Gülkesim D7) — tablet "Belge Tara" istemcisi
// =============================================================================
// Yalnız tarama + başlık: DRAFT irsaliye + sayfa fotoğrafları. Onay panelde (SoD, `gelen-belge:approve`).
// Uçlar `gelen-belge:write`; modül kapalıyken 403 MODULE_DISABLED (ekran zaten gizli).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** Fotoğraf gövdesi 1–2 MB base64; varsayılan 10 sn atölye Wi-Fi'ında yetmez. */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface InboundDocTabletContext {
  customers: { id: string; name: string }[];
}

export interface CreateDraftNoteBody {
  clientToken: string;
  sourceKind: 'MANUAL';
  ownerCustomerId: string | null;
  senderDocNo: string | null;
  pageCount: number;
}

export interface DraftNote {
  id: string;
  noteNo: string;
  status: string;
}

export interface UploadScanBody {
  contentBase64: string;
  noteId: string;
  pageNo: number;
  barcodeText: string | null;
  sha256: string;
}

export interface UploadScanResult {
  scan: { id: string; sha256: string; noteId: string | null };
  duplicate: boolean;
  boundTo: string | null;
}

export const inboundDocService = {
  tabletContext: (): Promise<ApiResponse<InboundDocTabletContext>> =>
    apiClient.get<ApiResponse<InboundDocTabletContext>>('/gelen-belge/tablet-baglam').then((r) => r.data),

  createDraftNote: (body: CreateDraftNoteBody): Promise<DraftNote> =>
    apiClient.post<ApiResponse<DraftNote>>('/gelen-belge/irsaliyeler', body).then((r) => r.data.data),

  uploadScan: (body: UploadScanBody): Promise<UploadScanResult> =>
    apiClient
      .post<ApiResponse<UploadScanResult>>('/gelen-belge/taramalar', body, { timeout: UPLOAD_TIMEOUT_MS })
      .then((r) => r.data.data),
};

export type InboundDocApi = Pick<typeof inboundDocService, 'createDraftNote' | 'uploadScan'>;
