// K27 BLOCK: İE kaydı 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO` → aynı (sahip, belge no) belgesi kısayol kartıyla gösterilir.
// Sorgu düşerse / eski sunucu → null = bugünkü hata satırı. "Yine de yeni kayıt aç" yok (BLOCK fabrika politikası).
import type { InboundDocApi, SameDocumentMatch } from '../../../../services/inboundDoc.service';

export const DUPLICATE_DOC_NO_BLOCK = 'DELIVERY_NOTE_DUPLICATE_DOC_NO';

export async function sameDocOnSave(
  api: Pick<InboundDocApi, 'findSameDocument'>,
  error: unknown,
  q: { noteId: string; ownerCustomerId: string | null; senderDocNo: string | null | undefined },
): Promise<SameDocumentMatch | null> {
  const e = error as { status?: number; details?: { code?: string } } | null;
  if (e?.status !== 409 || e.details?.code !== DUPLICATE_DOC_NO_BLOCK || !api.findSameDocument) return null;
  if (!q.ownerCustomerId || !q.senderDocNo) return null;
  try {
    return await api.findSameDocument({ ownerCustomerId: q.ownerCustomerId, senderDocNo: q.senderDocNo, excludeNoteId: q.noteId });
  } catch {
    return null;
  }
}
