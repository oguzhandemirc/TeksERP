// "Gelen kg" ve "Gelen en" beyan kutuları (T2 + 2026-11-09): belgeden önerilen gelen kg (`incomingKg`, sunucu `pickIncomingKg`)
// ve okunan en (şablon `en`) — İE hedefi DEĞİLDİR (hedef kg / İE eni sağ sütunda ayrı). Elle değişince gövdeye girer; sayfada
// boş kaydetmek ya da "Belgedekine dön" belgedekine döndürür (sunucu da anahtarsız gövdede belgedekini yazar).
import React, { useState } from 'react';
import type { IncomingKgSource } from '../../../../services/inboundDoc.service';
import { fmtKursunMeters } from '../readResult';
import { parseMeters } from '../approvalGate';
import { DeclaredEditSheet, DeclaredField } from './DeclaredField';
import { docIncomingWidth } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';

const SOURCE_TEXT: Record<IncomingKgSource, string> = { FIELD: 'belgedeki kg alanından', TOTAL: 'belgedeki toplamdan', LINE_SUM: 'satır toplamı' };

/** Düzeltme sayfasının alt başlığı: belgedeki değer + kaynağı ya da "Belgede kg yok". */
export function incomingKgNote(a: { suggested: number | null; source: IncomingKgSource | null }): string {
  if (a.suggested == null) return 'Belgede kg yok';
  return `Belgede: ${fmtKursunMeters(a.suggested)} kg${a.source ? ` (${SOURCE_TEXT[a.source]})` : ''}`;
}

const numText = (n: number | null | undefined) => (n != null ? String(n).replace('.', ',') : '');
const fmt = (n: number | null | undefined) => (n != null ? fmtKursunMeters(n) : null);

export function IncomingKgField({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  const [open, setOpen] = useState(false);
  const suggested = row.detail?.incomingKg != null && Number(row.detail.incomingKg) > 0 ? Number(row.detail.incomingKg) : null;
  const value = f.incomingKg ?? null;
  const fromDoc = !f.incomingKgEdited && value != null && value === suggested;
  const back = () => { setOpen(false); wo.updateForm(row.noteId, { incomingKg: suggested, incomingKgEdited: false }); };
  return (
    <>
      <DeclaredField label="Gelen kg" value={fmt(value)} unit="kg" fromDoc={fromDoc} emptyText="Belgede yok" onPress={() => setOpen(true)} disabled={locked}
        testID={`belge-satir-kg-${row.noteNo}`} />
      {open && (
        <DeclaredEditSheet title="Gelen kg" subtitle={incomingKgNote({ suggested, source: row.detail?.incomingKgSource ?? null })} kind="number" label="Gelen kg"
          initial={numText(value)} allowEmpty parse={parseMeters} resetLabel={suggested != null && !fromDoc ? 'Belgedekine dön' : undefined} onReset={back}
          onDismiss={() => setOpen(false)} testID={`belge-satir-kg-duzelt-${row.noteNo}`}
          onSave={(t) => {
            const n = parseMeters(t);
            if (n == null) back();
            else { setOpen(false); wo.updateForm(row.noteId, { incomingKg: n, incomingKgEdited: n !== suggested }); }
          }} />
      )}
    </>
  );
}

export function IncomingWidthField({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  const [open, setOpen] = useState(false);
  const docWidth = docIncomingWidth(row.detail);
  const value = f.incomingWidthEdited ? f.incomingWidth ?? null : docWidth;
  const fromDoc = !f.incomingWidthEdited && docWidth != null;
  const back = () => { setOpen(false); wo.updateForm(row.noteId, { incomingWidth: null, incomingWidthEdited: false }); };
  return (
    <>
      <DeclaredField label="Gelen en" value={fmt(value)} unit="cm" fromDoc={fromDoc} emptyText="Belgede yok" onPress={() => setOpen(true)} disabled={locked}
        testID={`belge-satir-en-${row.noteNo}`} />
      {open && (
        <DeclaredEditSheet title="Gelen en" subtitle={docWidth != null ? `Belgede: ${fmt(docWidth)} cm` : 'Belgede en yok'} kind="number" label="Gelen en (cm)"
          initial={numText(value)} allowEmpty parse={parseMeters} resetLabel={docWidth != null && !fromDoc ? 'Belgedekine dön' : undefined} onReset={back}
          onDismiss={() => setOpen(false)} testID={`belge-satir-en-duzelt-${row.noteNo}`}
          onSave={(t) => {
            const n = parseMeters(t);
            if (n == null || n === docWidth) back();
            else { setOpen(false); wo.updateForm(row.noteId, { incomingWidth: n, incomingWidthEdited: true }); }
          }} />
      )}
    </>
  );
}
