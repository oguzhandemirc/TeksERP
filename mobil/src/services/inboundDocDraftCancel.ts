// "Taslağı iptal et" — yarım kalan okutma taslağı. Sunucuda ④ sert silme (`DELETE /gelen-belge/irsaliyeler/:id`, yalnız
// DRAFT, atomik claim + audit); onay kartının sayıları toplu silme önizlemesinden (`POST …/toplu-sil/onizleme`, YAZMAZ).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** Önizleme kaydı (sunucu `BulkDeletePreviewItem`); `partyCount` eski sunucuda yok → null gösterilir. */
export interface DraftCancelPreview {
  id: string;
  noteNo: string | null;
  deletable: boolean;
  code: string | null;
  reason: string | null;
  lineCount: number;
  partyCount?: number;
  scanCount: number;
}

export const draftCancelService = {
  preview: (noteId: string): Promise<DraftCancelPreview | null> =>
    apiClient
      .post<ApiResponse<{ items: DraftCancelPreview[] }>>('/gelen-belge/irsaliyeler/toplu-sil/onizleme', { ids: [noteId] })
      .then((r) => r.data.data?.items?.[0] ?? null),

  cancel: (noteId: string): Promise<unknown> =>
    apiClient.delete<ApiResponse<unknown>>(`/gelen-belge/irsaliyeler/${noteId}`).then((r) => r.data.data),
};

/** Onay kartının içerik satırı (saf; test React'siz okur). */
export function draftContentsText(p: Pick<DraftCancelPreview, 'lineCount' | 'partyCount' | 'scanCount'>): string {
  const parts = [`${p.lineCount} satır`, p.partyCount == null ? null : `${p.partyCount} parti`, `${p.scanCount} sayfa fotoğrafı`];
  return parts.filter(Boolean).join(' · ');
}
