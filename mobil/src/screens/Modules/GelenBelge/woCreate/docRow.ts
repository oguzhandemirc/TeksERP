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
  /** K30-A: yeniden okutulamayan belge yerelde tanıtıldı; `seq` tek formu yeniden doldurur (okuma izlemi baştan BAŞLAMAZ). */
  taught?: { seq: number; code: string; name: string };
}

export interface SavedRow {
  noteId: string;
  noteNo: string;
  result: RowResult;
}

/** PER_PARTY kısmi başarı (2026-11-06): bazı partilerin İE'si açıldı, düşenler düzeltilip yeniden gönderilir (açılanlar yeniden açılmaz). */
export const isPartial = (r: DocRow): boolean => r.result?.kind === 'OPENED' && (r.result.failed?.length ?? 0) > 0;
/** Satır kapandı (kilitli, kayıt listesinde değil) — her yüzey bu tek yüklemi okur. */
export const isDone = (r: DocRow): boolean => (r.result?.kind === 'OPENED' && !isPartial(r)) || r.result?.kind === 'DRAFT';
/** Düzenleme sonucu siler; açılmış İE'ler (kısmi başarı dahil) ekranda kalır. */
export const keptResult = (r: DocRow): RowResult | null => (r.result?.kind === 'OPENED' || r.result?.kind === 'DRAFT' ? r.result : null);

/** Parti özeti form kurulduktan sonra gelir: çok partideyse satır listesi bir kez kurulur (kullanıcı düzenlemesi ezilmez). */
export function applyParties(rs: DocRow[], noteId: string, parties: NotePartiesView | null): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && r.parties === undefined ? { ...r, parties, form: { ...r.form, multi: initialMultiParty(parties) } } : r));
}

export function applyMulti(rs: DocRow[], noteId: string, multi: MultiPartyDraft): DocRow[] {
  return rs.map((r) => (r.noteId === noteId && r.form && !isDone(r) ? { ...r, form: { ...r.form, multi }, result: keptResult(r) } : r));
}

const text = (v: string | null | undefined): string | null => (v != null && v.trim() !== '' ? v.trim() : null);

/**
 * Tanıtma önizlemesinin değerleriyle satır: form alanları + metre + (aday listesinde varsa) parti no + müşteri. `runKey`
 * artmaz (artarsa okuma izlemi baştan başlar, sunucunun eski özeti şeridi "tanıtılmamış"a döndürür); `taught.seq` artar.
 */
export function taughtRow(r: DocRow, f: Record<string, string | null>, ownerCustomerId: string | null, tpl: { code: string; name: string }): DocRow {
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
      // Müşteri parti no adaydan bağımsız: tanıtılan metin elle yazılmış gibi dolar (kullanıcı düzelttiyse dokunulmaz).
      ...(text(f.partiNo) && !form.customerBatchNoEdited ? { customerBatchNo: text(f.partiNo), customerBatchNoFromDoc: true } : {}),
      ...(ownerCustomerId ? { ownerCustomerId, ownerSuggested: null } : {}),
    };
  }
  return { ...r, detail: { ...r.detail, formFields: ff }, form, taught: { seq: (r.taught?.seq ?? 0) + 1, ...tpl } };
}

/**
 * Belgesiz (elle) açılan taslağa sonradan belge eklendi: okuma yalnız BOŞ alanları önerir, elle yazılan ASLA ezilmez.
 * Çok parti / ayrı top yalnız ikisi de boşken okumadan gelir.
 */
export function fillEmptyRowForm(form: RowForm, read: RowForm): RowForm {
  const next: RowForm = { ...form };
  if (!form.ownerCustomerId) {
    next.ownerCustomerId = read.ownerCustomerId;
    next.ownerSuggested = read.ownerSuggested;
    next.ownerAsk = form.ownerAsk ?? read.ownerAsk;
  }
  if (!form.ourBatchNo) {
    next.ourBatchNo = read.ourBatchNo;
    next.ourBatchNoKey = read.ourBatchNoKey;
  }
  if (!form.customerBatchNo && read.customerBatchNo) {
    next.customerBatchNo = read.customerBatchNo;
    next.customerBatchNoFromDoc = read.customerBatchNoFromDoc;
  }
  if (form.meters == null && read.meters != null) {
    next.meters = read.meters;
    next.metersReview = read.metersReview;
  }
  if (!form.gramajValueId) next.gramajValueId = read.gramajValueId;
  if (!form.multi && !form.rolls && read.multi) next.multi = read.multi;
  return next;
}
