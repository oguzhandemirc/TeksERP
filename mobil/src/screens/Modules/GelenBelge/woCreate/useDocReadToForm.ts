// Okuma bitince belgeden gelenler forma dolar (aynı okuma bir kez; elle değiştirilen alan ezilmez); belge çıkınca temizlenir.
// Hedef kutularına kopyalama kararı `targetPrefill.docCopy`den gelir.
import React, { useEffect } from 'react';
import type { DocRow } from './useWoRows';
import { docCopy, type TargetPrefillCtx } from './targetPrefill';
import { applyDocReadCopy, clearDocRead, type WoFormState } from './woForm';

export function useDocReadToForm(row: DocRow | null, setForm: React.Dispatch<React.SetStateAction<WoFormState>>, prefill: TargetPrefillCtx) {
  const copy = docCopy(prefill);
  // Kopyalama kararı anahtarda: ⚙ anahtarı / ayar sonradan değişince okuma yeniden uygulanır (dokunulmamış hedef alanlar yeni karara uyar).
  const readKey = row?.detail ? `${row.noteId}#${row.runKey}#${row.taught?.seq ?? 0}#${+copy.width}${+copy.targetQuantity}${+copy.targetWeight}` : null;
  const detail = row?.detail ?? null;
  useEffect(() => {
    if (readKey && detail) setForm((s) => applyDocReadCopy(s, readKey, { fields: detail.formFields, suggestions: detail.suggestions }, copy));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- copy readKey'den türer
  }, [readKey, detail, setForm]);
  const hasRow = !!row;
  useEffect(() => {
    if (!hasRow) setForm((s) => (s.appliedNoteId ? clearDocRead(s) : s));
  }, [hasRow, setForm]);
}
