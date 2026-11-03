// Gülkesim K27 aynı gönderen belge no (WARN kipi): onay 409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` → soru diyaloğu.
// Hüküm sunucuda; BLOCK kipinin kodu (`DELIVERY_NOTE_DUPLICATE_DOC_NO`) burada yakalanmaz → bugünkü hata bildirimi kalır.
// Tablette belge detayı yok: eşin künyesi (GB no + iş emri) metinde, önceki belge panelden açılır.
import React from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog';

export const DUPLICATE_DOC_NO_ACTIVE = 'DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE';

export interface DocNoPeer {
  id: string;
  noteNo: string;
  status: string;
  workOrderNumbers: string[];
}
export interface DuplicateDocNoConflict {
  senderDocNo: string;
  peers: DocNoPeer[];
}

/** apiClient'ın normalize hatasından (`details.code` — `body.code` değil) künye; başka hata → null. */
export function duplicateDocNoConflict(error: unknown): DuplicateDocNoConflict | null {
  const e = error as { details?: { code?: unknown; senderDocNo?: unknown; peers?: unknown } } | null;
  if (!e || e.details?.code !== DUPLICATE_DOC_NO_ACTIVE) return null;
  return { senderDocNo: typeof e.details.senderDocNo === 'string' ? e.details.senderDocNo : '', peers: Array.isArray(e.details.peers) ? (e.details.peers as DocNoPeer[]) : [] };
}

export function duplicateDocNoMessage(c: DuplicateDocNoConflict): string {
  const nos = c.peers.map((p) => p.noteNo).join(', ') || 'başka bir belge';
  const wos = c.peers.flatMap((p) => p.workOrderNumbers);
  const no = c.senderDocNo ? ` (${c.senderDocNo})` : '';
  return `Bu belge no${no} ${nos} olarak zaten kayıtlı (iş sürüyor${wos.length ? `: ${wos.join(', ')}` : ''}). Aynı kâğıdı ikinci kez mi okutuyorsunuz?\n\nÖnceki belge panelde Gelen Belgeler'den açılır.`;
}

export function DuplicateDocNoDialog({ conflict, busy, onCancel, onConfirm }: { conflict: DuplicateDocNoConflict | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!conflict) return null;
  return (
    <ConfirmDialog
      kind="simple"
      visible
      title="Aynı belge no"
      description={duplicateDocNoMessage(conflict)}
      cancelLabel="Vazgeç"
      confirmLabel="Yine de onayla"
      confirming={busy}
      onDismiss={onCancel}
      onConfirm={onConfirm}
    />
  );
}
