// Canlı okuma (L3) kilitleri → İE formu. Fotoğraf okuması boşsa kilit yazılır; ikisi de dolu ve farklıysa kilit sessizce
// kazanmaz: alan "Kontrol edin" (`liveConflicts`) ile gelir, varsayılan elle kilitte kilit, oy kilidinde fotoğraf (tam
// çözünürlük). Uygulama TEK yerde, okuma detayının satıra girdiği sınırda (`useWoRows.setDetail`) `applyLiveLocks` ile.
// Kilitler çekilen fotoğrafın sha256'sına kaydedilir, gönderim taslağı doğurunca not kimliğine bağlanır (`useDocScan.send`).
import type { DocFormFields, InboundNoteDetail } from '../../../../services/inboundDoc.service';
import { parseMeters } from '../approvalGate';
import { isLiveSettled, normalizeLiveValue } from './liveVote';

/** Şablon alan anahtarı (`ASSIGNABLE_FIELDS`) → okuma detayındaki form alanı. Başka anahtar formda karşılıksızdır. */
const FORM_FIELD: Partial<Record<string, keyof DocFormFields>> = {
  hedefMetraj: 'hedefMetraj',
  hedefKg: 'hedefKg',
  en: 'en',
  desen: 'desenText',
  renk: 'renkText',
  not: 'not',
};

/** Panelde yalnız BİLGİ olan alanlar: forma gitmez (müşteri, fotoğrafın sunucu okumasından öneri/modal yoluyla gelir),
 *  kilitlenmesi otomatik çekimi beklemez. */
const INFO_ONLY_KEYS = new Set(['musteri']);

export function isLiveInfoOnly(key: string): boolean {
  return INFO_ONLY_KEYS.has(key);
}

/** Otomatik çekim koşulu: bilgi dışı en az bir alan var ve hepsi tamam — kilitli ya da "Belgede yok" (belge tanınmadan çekim olmaz). */
export function liveFormLocked(fields: readonly { key: string; lock: unknown; history?: readonly (string | null)[] }[]): boolean {
  const formFields = fields.filter((f) => !isLiveInfoOnly(f.key));
  return formFields.length > 0 && formFields.every(isLiveSettled);
}

/** Canlı kilit ile fotoğraf okuması çelişen alan: ikisi de görünür, `chosen` forma yazılan. */
export interface LiveConflict {
  key: string;
  label: string;
  live: string;
  photo: string;
  chosen: 'live' | 'photo';
}

export type LiveLockedDetail = InboundNoteDetail & { liveConflicts?: LiveConflict[] };

const CONFLICT_LABEL: Record<string, string> = {
  hedefMetraj: 'Hedef metre', hedefKg: 'Hedef kg', en: 'En', desen: 'Desen', renk: 'Renk', not: 'Not', toplamMetre: 'Gelen metre', partiNo: 'Müşteri parti no',
};
const NUMERIC_KEYS = new Set(['hedefMetraj', 'hedefKg', 'en', 'toplamMetre']);

/** Aynı değer mi: sayısal alanda sayı olarak (1.250 = 1250), metinde normalize + harf büyüklüğü yok sayılarak. */
export function sameLiveValue(key: string, a: string, b: string): boolean {
  if (NUMERIC_KEYS.has(key)) {
    const x = parseMeters(a);
    const y = parseMeters(b);
    if (x !== null && y !== null) return x === y;
  }
  return (normalizeLiveValue(a) ?? '').toUpperCase() === (normalizeLiveValue(b) ?? '').toUpperCase();
}

export function liveConflictsOf(d: InboundNoteDetail | null | undefined): LiveConflict[] {
  return (d as LiveLockedDetail | null | undefined)?.liveConflicts ?? [];
}

/** Formdaki "Kontrol edin" iletisi: iki değer + hangisinin seçildiği. */
export function liveConflictText(c: LiveConflict): string {
  const pick = c.chosen === 'photo' ? 'fotoğraftaki seçildi' : 'canlı okumadaki seçildi';
  return `Kontrol edin — ${c.label}: fotoğraf "${c.photo}", canlı okuma "${c.live}" (${pick}).`;
}

const clean = (v: string | number | null | undefined): string | null => (v != null && String(v).trim() !== '' ? String(v).trim() : null);

/**
 * Okuma detayına kilitli değerleri yazar (saf). Form alanları + gelen metre (`toplamMetre` → kurşun metresi) + müşteri
 * parti no (`partiNo`). Fotoğraf okuması boş ya da aynıysa kilit yazılır (metre gözden geçirme istemez); farklıysa
 * `liveConflicts`e girer ve seçim `userKeys`e göre yapılır (metre çelişkisi ayrıca `kursunMetersReview`). Kilitli
 * desen/renk forma girip okunandan farklıysa o okumanın katalog önerisi düşer. Kilit yoksa detay AYNEN döner.
 * `musteri` metni kimliğe çevrilemez → dokunulmaz.
 */
export function applyLiveLocks(
  d: InboundNoteDetail,
  locks: Readonly<Record<string, string>> | null | undefined,
  userKeys: readonly string[] = [],
): LiveLockedDetail {
  if (!locks || !Object.keys(locks).length) return d;
  const user = new Set(userKeys);
  const conflicts: LiveConflict[] = [];
  /** Kilit mi yazılsın: fotoğraf boş/aynı → evet; çelişki → kayda geçer, elle kilitte evet, oy kilidinde hayır. */
  const lockWins = (key: string, live: string, photo: string | null): boolean => {
    if (photo === null || sameLiveValue(key, live, photo)) return true;
    const chosen = user.has(key) ? 'live' : 'photo';
    conflicts.push({ key, label: CONFLICT_LABEL[key] ?? key, live, photo, chosen });
    return chosen === 'live';
  };
  const ff: DocFormFields = { ...(d.formFields ?? {}) };
  let suggestions = d.suggestions ?? null;
  let touched = false;
  for (const [key, field] of Object.entries(FORM_FIELD)) {
    const v = clean(locks[key]);
    if (!v || !field) continue;
    const before = ff[field];
    if (!lockWins(key, v, clean(before))) continue;
    (ff as Record<string, unknown>)[field] = v;
    touched = true;
    if (suggestions && String(before ?? '').trim() !== v) {
      if (field === 'desenText' && suggestions.targetItem) suggestions = { ...suggestions, targetItem: null };
      if (field === 'renkText' && suggestions.targetColor) suggestions = { ...suggestions, targetColor: null };
    }
  }
  const out: LiveLockedDetail = { ...d, formFields: touched ? ff : d.formFields, suggestions };
  const meterText = clean(locks.toplamMetre);
  const meters = meterText ? parseMeters(meterText) : null;
  if (meterText && meters !== null) {
    const photo = clean(d.kursunMeters);
    const before = conflicts.length;
    const win = lockWins('toplamMetre', meterText, photo !== null && Number(photo) > 0 ? photo : null);
    const conflict = conflicts.length > before;
    if (win) Object.assign(out, { kursunMeters: meters, kursunMetersReview: conflict });
    else if (conflict) out.kursunMetersReview = true;
  }
  const batch = clean(locks.partiNo);
  if (batch && lockWins('partiNo', batch, clean(d.customerBatchNo))) out.customerBatchNo = batch;
  if (conflicts.length) out.liveConflicts = conflicts;
  return out;
}

// --- Kilit deposu: yalnız bellek (oturum boyu), küçük tavanlı. Fotoğraf → not bağı gönderim anında kurulur. ---
const MAX_ENTRIES = 20;
const byPhoto = new Map<string, Record<string, string>>();
const byNote = new Map<string, Record<string, string>>();
/** Elle kilitlenen anahtarlar (fotoğraf / not başına); çelişkide kilidin kazanıp kazanmayacağını belirler. */
const userByPhoto = new Map<string, string[]>();
const userByNote = new Map<string, string[]>();

function cap<V>(m: Map<string, V>): void {
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string);
}

/** Canlı ekran fotoğrafı çekince: kilitler fotoğrafın sha256'sına. Boş kilit kaydedilmez. */
export function rememberLiveLocks(sha256: string, locks: Record<string, string>, userKeys: readonly string[] = []): void {
  if (!Object.keys(locks).length) return;
  byPhoto.set(sha256, { ...locks });
  userByPhoto.set(sha256, [...userKeys]);
  cap(byPhoto);
  cap(userByPhoto);
}

/** Gönderim taslağı doğurdu: gönderilen sayfalardan kilidi olan varsa not kimliğine taşınır. */
export function bindLiveLocks(noteId: string, sha256s: readonly string[]): void {
  for (const sha of sha256s) {
    const l = byPhoto.get(sha);
    if (!l) continue;
    byPhoto.delete(sha);
    byNote.set(noteId, { ...(byNote.get(noteId) ?? {}), ...l });
    // Sonraki fotoğrafın kilidi öncekini ezer: ezilen anahtarın "elle" bilgisi de yeni fotoğraftan gelir.
    const keys = Object.keys(l);
    const fresh = userByPhoto.get(sha) ?? [];
    userByPhoto.delete(sha);
    userByNote.set(noteId, [...(userByNote.get(noteId) ?? []).filter((k) => !keys.includes(k)), ...fresh]);
    cap(byNote);
    cap(userByNote);
  }
}

export function liveLocksFor(noteId: string): Record<string, string> | null {
  return byNote.get(noteId) ?? null;
}

export function liveUserKeysFor(noteId: string): string[] {
  return userByNote.get(noteId) ?? [];
}

export function resetLiveLocks(): void {
  byPhoto.clear();
  byNote.clear();
  userByPhoto.clear();
  userByNote.clear();
}
