// "Gelen kumaş" ve "Gelen renk" beyan kutuları (2026-11-09): belgedeki müşteri yazısı, İE hedefi DEĞİL. `DeclaredField` ile
// aynı stil: belgeden geldi ve değişmediyse sarı, dokununca düzeltme sayfası, boşsa "Belgede yok". Gelen metre/kg/en
// satırının altında aynı yükseklikte ikinci satır; çok partide partinin kendi satırında.
import React, { useState } from 'react';
import { View } from 'react-native';
import { DeclaredEditSheet, DeclaredField, declaredLayout } from './DeclaredField';
import { applyDeclaredText, docDeclaredText, partyDeclaredText, shownDeclared, type DeclaredKind } from './incomingDeclared';
import type { NoteParty } from '../../../../services/inboundDoc.service';
import type { PartyRow } from './partyDraft';
import type { DocRow, WoRowsState } from './useWoRows';

const LABEL: Record<DeclaredKind, string> = { item: 'Gelen kumaş', color: 'Gelen renk' };

interface BoxProps {
  kind: DeclaredKind;
  title: string;
  doc: string | null;
  edited: boolean;
  text: string | null;
  locked: boolean;
  testSuffix: string;
  onApply: (typed: string) => void;
  onReset: () => void;
}

function DeclaredTextBox({ kind, title, doc, edited, text, locked, testSuffix, onApply, onReset }: BoxProps) {
  const [open, setOpen] = useState(false);
  const value = edited ? text : doc;
  const fromDoc = !edited && doc != null;
  const id = `${kind === 'item' ? 'kumas' : 'renk'}-${testSuffix}`;
  return (
    <>
      <DeclaredField label={LABEL[kind]} value={value} fromDoc={fromDoc} emptyText="Belgede yok" onPress={() => setOpen(true)} disabled={locked} testID={`belge-gelen-${id}`} />
      {open && (
        <DeclaredEditSheet title={title} subtitle={doc != null ? `Belgede: ${doc}` : 'Belgede yok'} kind="text" label={LABEL[kind]} maxLength={120} allowEmpty initial={value ?? ''}
          resetLabel={doc != null && edited ? 'Belgedekine dön' : undefined} onReset={() => { setOpen(false); onReset(); }}
          onDismiss={() => setOpen(false)} testID={`belge-gelen-${id}-duzelt`}
          onSave={(t) => { setOpen(false); onApply(t); }} />
      )}
    </>
  );
}

/** Tek partili form: belge satırının gelen kumaş / renk kutuları. */
export function IncomingDeclaredRow({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  const box = (kind: DeclaredKind) => {
    const doc = docDeclaredText(row.detail, kind);
    const k = kind === 'item' ? { text: 'incomingItemText', edited: 'incomingItemEdited' } as const : { text: 'incomingColorText', edited: 'incomingColorEdited' } as const;
    return (
      <DeclaredTextBox key={kind} kind={kind} title={LABEL[kind]} doc={doc} edited={!!f[k.edited]} text={shownDeclared({ text: f[k.text] ?? null, edited: !!f[k.edited] }, doc)}
        locked={locked} testSuffix={row.noteNo}
        onApply={(t) => { const e = applyDeclaredText(t, doc); wo.updateForm(row.noteId, { [k.text]: e.text, [k.edited]: e.edited }); }}
        onReset={() => wo.updateForm(row.noteId, { [k.text]: null, [k.edited]: false })} />
    );
  };
  return <View style={declaredLayout.row} testID={`belge-gelen-beyan-${row.noteNo}`}>{box('item')}{box('color')}</View>;
}

/** Çok partili form: partinin gelen kumaş / renk kutuları (bölüm beyanı, yoksa belge geneli). */
export function PartyDeclaredRow({ r, p, detail, noteNo, locked, onChange }: { r: PartyRow; p: NoteParty | undefined; detail: DocRow['detail']; noteNo: string; locked: boolean; onChange: (patch: Partial<PartyRow>) => void }) {
  const box = (kind: DeclaredKind) => {
    const doc = partyDeclaredText(p, detail, kind);
    const k = kind === 'item' ? { text: 'incomingItemText', edited: 'itemEdited' } as const : { text: 'incomingColorText', edited: 'colorEdited' } as const;
    return (
      <DeclaredTextBox key={kind} kind={kind} title={`${r.blockNo}. parti · ${LABEL[kind]}`} doc={doc} edited={!!r[k.edited]} text={r[k.text] ?? null} locked={locked} testSuffix={`${noteNo}-${r.blockNo}`}
        onApply={(t) => { const e = applyDeclaredText(t, doc); onChange({ [k.text]: e.text, [k.edited]: e.edited }); }}
        onReset={() => onChange({ [k.text]: null, [k.edited]: false })} />
    );
  };
  return <View style={declaredLayout.row}>{box('item')}{box('color')}</View>;
}
