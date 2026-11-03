// Belgeden İE satırının tipi ve saf satır dönüşümleri (useWoRows'tan ayrıldı: dosya sınırı; davranış aynı).
import type { DocFormFields, InboundNoteDetail, NotePartiesView } from '../../../../services/inboundDoc.service';
import { batchPatch, parseMeters } from '../approvalGate';
import { initialMultiParty, type MultiPartyDraft } from './partyDraft';
import type { RowForm, RowResult } from './woFromDoc';

export interface DocRow {
  noteId: string;
  noteNo: string;
  runKey: number;
  detail: InboundNoteDetail | null;
  form: RowForm | null;
  /** Kullanıcı gramajı elle seçti/kaldırdı: geç gelen katalog varsayılanı onu ezmez. */
  gramajTouched: boolean;
  result: RowResult | null;
  /** S1 parti özeti (çok partili belgede liste + uyarılar); yok = tek partili form. */
  parties?: NotePartiesView | null;
}

export interface SavedRow {
  noteId: string;
  noteNo: string;
  result: RowResult;
}

export const isDone = (r: DocRow): boolean => r.result?.kind === 'OPENED' || r.result?.kind === 'DRAFT';

/** Parti özeti form kurulduktan sonra gelir: çok partideyse satır listesi bir kez kurulur (kullanıcı düzenlemesi ezilmez). */
export function applyParties(rs: DocRow[], noteId: string, parties: NotePartiesView | null): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && r.parties === undefined ? { ...r, parties, form: { ...r.form, multi: initialMultiParty(parties) } } : r));
}

export function applyMulti(rs: DocRow[], noteId: string, multi: MultiPartyDraft): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && !isDone(r) ? { ...r, form: { ...r.form, multi }, result: null } : r));
}

const text = (v: string | null | undefined): string | null => (v != null && v.trim() !== '' ? v.trim() : null);

/** Tanıtma önizlemesinin değerleriyle satır: form alanları + metre + (aday listesinde varsa) parti no + müşteri; `runKey` artar → tek form yeniden dolar. */
export function taughtRow(r: DocRow, f: Record<string, string | null>, ownerCustomerId: string | null): DocRow {
  if (!r.detail || isDone(r)) return r;
  const ff = { ...(r.detail.formFields ?? {}) };
  const put = <K extends keyof DocFormFields>(k: K, v: string | null) => {
    if (v) ff[k] = v as DocFormFields[K];
  };
  put('hedefMetraj', text(f.hedefMetraj));
  put('hedefKg', text(f.hedefKg));
  put('en', text(f.en));
  put('desenText', text(f.desen));
  put('renkText', text(f.renk));
  put('not', text(f.not));
  let form = r.form;
  if (form) {
    const m = text(f.toplamMetre) ? parseMeters(f.toplamMetre!) : null;
    const cand = (r.detail.batchNoCandidates ?? []).find((c) => c.value === text(f.partiNo));
    form = {
      ...form,
      ...(m !== null ? { meters: m, metersReview: false } : {}),
      ...(cand ? { ourBatchNo: cand.value, ourBatchNoKey: batchPatch(cand).ourBatchNoKey ?? null } : {}),
      ...(ownerCustomerId ? { ownerCustomerId, ownerSuggested: null } : {}),
    };
  }
  return { ...r, detail: { ...r.detail, formFields: ff }, form, runKey: r.runKey + 1 };
}
