// Canlı okuma (L3) oylama + kilit — saf. Sunucu her karede alanları döner (tek kaynak motor); tablet yalnız oylar:
// alanın normalize değeri son N yanıtta ≥K kez aynıysa KİLİT. Oy kilidi kendini düzeltir (pencerede kilitten farklı aynı
// değer ≥RELOCK → o değere geçer); elle kilit ("user") oylamadan asla etkilenmez. Şablon tanındıktan sonra son N yanıtın
// hiçbirinde değer yoksa alan "Belgede yok" (absent) sayılır. Etiket-benzeri değer ve bulanık kare oy değildir.
import { LIVE_CORRECTED_SHOW, LIVE_VOTE_QUORUM, LIVE_VOTE_RELOCK, LIVE_VOTE_WINDOW } from './liveTuning';

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
  /** >0: oy kilidi az önce başka değere düzeltildi ("Düzeltildi" işareti kalan yanıt sayısı). */
  corrected?: number;
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

// Belgelerin başlık etiketleri (ASCII katlanmış, büyük harf). Sunucu etiket sedini (`label-guard.ts`) geçen ama kâğıtta
// başlık olan sözcük tablette ikinci kez elenir.
const HEADER_WORDS = new Set([
  'TARIH', 'MUSTERI', 'FIRMA', 'UNVAN', 'ADRES', 'CINSI', 'CINS', 'KUMAS', 'DESEN', 'RENK', 'RENGI', 'EN', 'ENI', 'METRE', 'MT',
  'KG', 'KILO', 'GRAMAJ', 'PARTI', 'LOT', 'NO', 'NUMARA', 'TOP', 'ADET', 'MIKTAR', 'TOPLAM', 'ACIKLAMA', 'NOT', 'IRSALIYE',
  'BELGE', 'SIPARIS', 'EVRAK', 'TESLIM', 'ALAN', 'EDEN', 'SEVK', 'TARIHI', 'BIRIM', 'FIYAT', 'TUTAR', 'IMZA', 'KASE',
]);

/** Türkçe harfleri ASCII'ye katlayıp büyütür (karşılaştırma için; yerel ayara bağlı büyütme yasak). */
function foldUpper(v: string): string {
  return v.replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

/** Etiket-benzeri değer: rakamsız ve ":" ile biter, ya da yalnız harflerden oluşup her sözcüğü bilinen başlık sözcüğüdür. */
export function isLabelLikeValue(v: string): boolean {
  const core = v.replace(/[:\s.]+$/, '');
  if (/\d/.test(core)) return false;
  if (/:\s*$/.test(v)) return true;
  const words = foldUpper(core).split(/[\s/.-]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => /^[A-Z]+$/.test(w) && HEADER_WORDS.has(w));
}

/** Oylamaya girecek değer: normalize + etiket-benzeri olan null. */
function voteValue(raw: string | null | undefined): string | null {
  const v = normalizeLiveValue(raw);
  return v !== null && isLabelLikeValue(v) ? null : v;
}

function voteField(f: LiveField, raw: string | null, counts: boolean): LiveField {
  const value = voteValue(raw);
  const fade = f.corrected ? f.corrected - 1 : 0;
  // Bulanık kare: aday görünür ama oy değil (pencere kaymaz).
  if (!counts) return { ...f, candidate: value, corrected: fade };
  const history = [...f.history, value].slice(-LIVE_VOTE_WINDOW);
  const top = topVote(history);
  const next = { ...f, history, candidate: value, corrected: fade };
  if (f.lock?.by === 'user') return next;
  if (f.lock) {
    // Kendini düzelten kilit: pencerede kilitten farklı aynı değer ≥RELOCK.
    const rival = topVote(history.filter((v) => v !== f.lock?.value));
    if (rival && rival.count >= LIVE_VOTE_RELOCK) return { ...next, lock: { value: rival.value, by: 'vote' }, corrected: LIVE_CORRECTED_SHOW };
    return next;
  }
  const lock: LiveLock | null = top && top.count >= LIVE_VOTE_QUORUM ? { value: top.value, by: 'vote' } : null;
  return { ...next, lock };
}

/**
 * Bir sunucu yanıtını oylamaya ekler. `template` null (tanınmadı) → durum değişmez (panel boşalmaz, kilit kaybolmaz).
 * Belge türü değişti → alanlar yeni şablondan sıfırdan kurulur.
 */
export function applyLiveReading(
  s: LiveVoteState,
  r: { template: { code: string; name: string } | null; fields: readonly LiveReadFieldView[] },
  opts: { counts?: boolean } = {},
): LiveVoteState {
  const counts = opts.counts !== false;
  if (!r.template) return s;
  const same = s.template?.code === r.template.code;
  const prev = new Map((same ? s.fields : []).map((f) => [f.key, f]));
  const fields = r.fields.map((rf) => {
    const base = prev.get(rf.key) ?? { key: rf.key, label: rf.label, history: [], candidate: null, lock: null };
    return voteField({ ...base, label: rf.label }, rf.value, counts);
  });
  return { template: { code: r.template.code, name: r.template.name }, fields };
}

/** Elle düzeltme: değer kilitlenir (operatör değeri). Boş değer kilidi açar. Geçmiş sıfırlanır: öneri yalnız yeni karelerden. */
export function editLiveField(s: LiveVoteState, key: string, value: string): LiveVoteState {
  const v = normalizeLiveValue(value);
  if (v === null) return unlockLiveField(s, key);
  return { ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, lock: { value: v, by: 'user' }, history: [], corrected: 0 } : f)) };
}

/** Kilidi aç: geçmiş silinir (eski oylar hemen yeniden kilitlemesin), oylama baştan. */
export function unlockLiveField(s: LiveVoteState, key: string): LiveVoteState {
  return { ...s, fields: s.fields.map((f) => (f.key === key ? { ...f, lock: null, history: [], corrected: 0 } : f)) };
}

/** "Belgede yok": kilitsiz ve şablon tanındıktan sonraki son N yanıtın HİÇBİRİNDE değer yok. Forma değer yazmaz. */
export function isLiveAbsent(f: { lock: unknown; history?: readonly (string | null)[] }): boolean {
  const h = f.history ?? [];
  return f.lock === null && h.length >= LIVE_VOTE_WINDOW && h.every((v) => v === null);
}

/** Tamamlanmış alan: kilitli ya da belgede yok. */
export function isLiveSettled(f: { lock: unknown; history?: readonly (string | null)[] }): boolean {
  return f.lock !== null || isLiveAbsent(f);
}

/** Kilitli alanda son karelerin kilitten farklı önerisi (pencerede ≥2 kez görülen); yoksa null. */
export function liveSuggestion(f: LiveField): string | null {
  if (!f.lock) return null;
  const rival = topVote(f.history.filter((v) => v !== f.lock?.value));
  return rival && rival.count >= 2 ? rival.value : null;
}

export type LiveFieldStatus = 'locked' | 'candidate' | 'empty' | 'absent';

export function liveFieldStatus(f: LiveField): LiveFieldStatus {
  if (f.lock) return 'locked';
  if (isLiveAbsent(f)) return 'absent';
  return f.candidate !== null ? 'candidate' : 'empty';
}

/** Tüm alanlar tamam mı (kilitli ya da belgede yok; alan yoksa hayır: belge tanınmadan otomatik çekim olmaz). */
export function allLiveLocked(s: LiveVoteState): boolean {
  return s.fields.length > 0 && s.fields.every(isLiveSettled);
}

/** Elle kilitlenmiş alan anahtarları (forma girişte çelişkide kilit kazanır). */
export function userLockedLiveKeys(s: LiveVoteState): string[] {
  return s.fields.filter((f) => f.lock?.by === 'user').map((f) => f.key);
}

/** Bitişte forma gidecek kilitli değerler (anahtar → değer). */
export function lockedLiveValues(s: LiveVoteState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of s.fields) if (f.lock) out[f.key] = f.lock.value;
  return out;
}
