// İE'nin kaynağı gelen belge taramaları (tablet Belgeler): liste + bayt. Uçlar panelin İE "Geldiği belge"siyle aynı;
// izin `gelen-belge:read`, modül kapalıysa 403 (çağıran sessizce gizler).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** Backend `gelen-belge-ie-kaynak.service.ts` `WorkOrderSourceNote` aynası (yalnız okunan alanlar). */
export interface SourceNoteScan {
  id: string;
  pageNo: number;
  regionNo: number | null;
  mimeType: string;
  contentState?: string | null;
}
export interface SourceNote {
  id: string;
  noteNo: string;
  senderDocNo: string | null;
  scans: SourceNoteScan[];
}

export const incomingScanService = {
  /** `GET /gelen-belge/is-emirleri/:id/belgeler` */
  workOrderNotes: (workOrderId: string): Promise<{ total: number; notes: SourceNote[] }> =>
    apiClient.get<ApiResponse<{ total: number; notes: SourceNote[] }>>(`/gelen-belge/is-emirleri/${workOrderId}/belgeler`).then((r) => r.data.data),

  /** `GET /gelen-belge/taramalar/:id/icerik` — ham bayt (sabitlenmiş TLS'li apiClient'tan; `Image` uri'si değil). */
  scanContent: (scanId: string): Promise<{ mimeType: string; bytes: Uint8Array }> =>
    apiClient
      .get<ArrayBuffer>(`/gelen-belge/taramalar/${scanId}/icerik`, { responseType: 'arraybuffer', timeout: 30_000 })
      .then((r) => ({ mimeType: String(r.headers['content-type'] ?? ''), bytes: new Uint8Array(r.data) })),
};
