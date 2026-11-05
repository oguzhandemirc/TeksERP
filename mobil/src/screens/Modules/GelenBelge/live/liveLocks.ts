// Canlı okuma (L3) kilitleri → İE formu. Kilitli değer operatör değeridir: fotoğrafın okumasını EZER. Uygulama TEK yerde,
// okuma detayının satıra girdiği sınırda (`useWoRows.setDetail`) `applyLiveLocks` ile. Kilitler çekilen fotoğrafın
// sha256'sına kaydedilir, gönderim taslağı doğurunca not kimliğine bağlanır (`useDocScan.send`).
import type { DocFormFields, InboundNoteDetail } from '../../../../services/inboundDoc.service';
import { parseMeters } from '../approvalGate';

/** Şablon alan anahtarı (`ASSIGNABLE_FIELDS`) → okuma detayındaki form alanı. Başka anahtar formda karşılıksızdır. */
const FORM_FIELD: Partial<Record<string, keyof DocFormFields>> = {
  hedefMetraj: 'hedefMetraj',
  hedefKg: 'hedefKg',
  en: 'en',
  desen: 'desenText',
  renk: 'renkText',
  not: 'not',
};

const clean = (v: string | undefined): string | null => (v != null && v.trim() !== '' ? v.trim() : null);

/**
 * Okuma detayına kilitli değerleri yazar (saf). Form alanları + gelen metre (`toplamMetre` → kurşun metresi, gözden
 * geçirme gerekmez) + müşteri parti no (`partiNo`). Kilitli desen/renk okunandan farklıysa o okumanın katalog önerisi
 * düşer (başka kumaşı önermesin). Kilit yoksa detay AYNEN döner. `musteri` metni kimliğe çevrilemez → dokunulmaz.
 */
export function applyLiveLocks(d: InboundNoteDetail, locks: Readonly<Record<string, string>> | null | undefined): InboundNoteDetail {
  if (!locks || !Object.keys(locks).length) return d;
  const ff: DocFormFields = { ...(d.formFields ?? {}) };
  let suggestions = d.suggestions ?? null;
  let touched = false;
  for (const [key, field] of Object.entries(FORM_FIELD)) {
    const v = clean(locks[key]);
    if (!v || !field) continue;
    const before = ff[field];
    (ff as Record<string, unknown>)[field] = v;
    touched = true;
    if (suggestions && String(before ?? '').trim() !== v) {
      if (field === 'desenText' && suggestions.targetItem) suggestions = { ...suggestions, targetItem: null };
      if (field === 'renkText' && suggestions.targetColor) suggestions = { ...suggestions, targetColor: null };
    }
  }
  const out: InboundNoteDetail = { ...d, formFields: touched ? ff : d.formFields, suggestions };
  const meters = clean(locks.toplamMetre) ? parseMeters(locks.toplamMetre) : null;
  if (meters !== null) Object.assign(out, { kursunMeters: meters, kursunMetersReview: false });
  const batch = clean(locks.partiNo);
  if (batch) out.customerBatchNo = batch;
  return out;
}

// --- Kilit deposu: yalnız bellek (oturum boyu), küçük tavanlı. Fotoğraf → not bağı gönderim anında kurulur. ---
const MAX_ENTRIES = 20;
const byPhoto = new Map<string, Record<string, string>>();
const byNote = new Map<string, Record<string, string>>();

function cap<V>(m: Map<string, V>): void {
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string);
}

/** Canlı ekran fotoğrafı çekince: kilitler fotoğrafın sha256'sına. Boş kilit kaydedilmez. */
export function rememberLiveLocks(sha256: string, locks: Record<string, string>): void {
  if (!Object.keys(locks).length) return;
  byPhoto.set(sha256, { ...locks });
  cap(byPhoto);
}

/** Gönderim taslağı doğurdu: gönderilen sayfalardan kilidi olan varsa not kimliğine taşınır. */
export function bindLiveLocks(noteId: string, sha256s: readonly string[]): void {
  for (const sha of sha256s) {
    const l = byPhoto.get(sha);
    if (!l) continue;
    byPhoto.delete(sha);
    byNote.set(noteId, { ...(byNote.get(noteId) ?? {}), ...l });
    cap(byNote);
  }
}

export function liveLocksFor(noteId: string): Record<string, string> | null {
  return byNote.get(noteId) ?? null;
}

export function resetLiveLocks(): void {
  byPhoto.clear();
  byNote.clear();
}
