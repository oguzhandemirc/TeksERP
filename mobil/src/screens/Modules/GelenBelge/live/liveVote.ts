// Canlı okuma (L3) oylama + kilit — saf. Sunucu her karede alanları döner (tek kaynak motor); tablet yalnız oylar:
// alanın normalize değeri son N yanıtta ≥K kez aynıysa KİLİT. Kilitli alan oylamadan etkilenmez; kullanıcı düzeltir
// (kilit "elle") ya da açar (geçmiş sıfırlanır, oylama baştan). Belge türü değişirse panel baştan kurulur.
import { LIVE_VOTE_QUORUM, LIVE_VOTE_WINDOW } from './liveTuning';

export interface LiveReadFieldView {
  key: string;
  label: string;
  value: string | null;
}

export interface LiveLock {
  value: string;
  by: 'vote' | 'user';
}

export interface LiveField {
  key: string;
  label: string;
  /** Son N yanıtın normalize değerleri (null = o karede bulunamadı); en yeni sonda. */
  history: (string | null)[];
  /** Son yanıttaki değer (gri aday). */
  candidate: string | null;
  lock: LiveLock | null;
}

export interface LiveVoteState {
  template: { code: string; name: string } | null;
  fields: LiveField[];
}

export const EMPTY_VOTE: LiveVoteState = { template: null, fields: [] };

/** Karşılaştırma biçimi: Unicode NFC, boşluklar teke iner, kenarlar kırpılır; boş → null. Harf büyüklüğü korunur. */
export function normalizeLiveValue(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/** Penceredeki en çok görülen değer ve sayısı (null'lar oy değildir; eşitlikte en yeni görülen kazanır). */
export function topVote(history: readonly (string | null)[]): { value: string; count: number } | null {
  const counts = new Map<string, number>();
  let best: { value: string; count: number } | null = null;
  for (const v of history) {
    if (v === null) continue;
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (!best || c >= best.count) best = { value: v, count: c };
  }
  return best;
}

function voteField(f: LiveField, raw: string | null): LiveField {
  if (f.lock) return f;
  const value = normalizeLiveValue(raw);
  const history = [...f.history, value].slice(-LIVE_VOTE_WINDOW);
  const top = topVote(history);
  const lock: LiveLock | null = top && top.count >= LIVE_VOTE_QUORUM ? { value: top.value, by: 'vote' } : null;
  return { ...f, history, candidate: value, lock };
}

/**
 * Bir sunucu yanıtını oylamaya ekler. `template` null (tanınmadı) → durum değişmez (panel boşalmaz, kilit kaybolmaz).
 * Belge türü değişti → alanlar yeni şablondan sıfırdan kurulur.
 */
export function applyLiveReading(s: LiveVoteState, r: { template: { code: string; name: string } | null; fields: readonly LiveReadFieldView[] }): LiveVoteState {
  if (!r.template) return s;
  const same = s.template?.code === r.template.code;
  const prev = new Map((same ? s.fields : []).map((f) => [f.key, f]));
  const fields = r.fields.map((rf) => {
    const base = prev.get(rf.key) ?? { key: rf.key, label: rf.label, history: [], candidate: null, lock: null };
    return voteField({ ...base, label: rf.label }, rf.value);
  });
  return { template: { code: r.template.code, name: r.template.name }, fields };
}

/** Elle düzeltme: değer kilitlenir (operatör değeri). Boş değer kilidi açar. */
export function editLiveField(s: LiveVoteState, key: string, value: string): LiveVoteState {
  const v = normalizeLiveValue(value);
  if (v === null) return unlockLiveField(s, key);
  return { ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, lock: { value: v, by: 'user' } } : f)) };
}

/** Kilidi aç: geçmiş silinir (eski oylar hemen yeniden kilitlemesin), oylama baştan. */
export function unlockLiveField(s: LiveVoteState, key: string): LiveVoteState {
  return { ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, lock: null, history: [] } : f)) };
}

export type LiveFieldStatus = 'locked' | 'candidate' | 'empty';

export function liveFieldStatus(f: LiveField): LiveFieldStatus {
  if (f.lock) return 'locked';
  return f.candidate !== null ? 'candidate' : 'empty';
}

/** Tüm alanlar kilitli mi (alan yoksa hayır: belge tanınmadan otomatik çekim olmaz). */
export function allLiveLocked(s: LiveVoteState): boolean {
  return s.fields.length > 0 && s.fields.every((f) => f.lock !== null);
}

/** Bitişte forma gidecek kilitli değerler (anahtar → değer). */
export function lockedLiveValues(s: LiveVoteState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of s.fields) if (f.lock) out[f.key] = f.lock.value;
  return out;
}
