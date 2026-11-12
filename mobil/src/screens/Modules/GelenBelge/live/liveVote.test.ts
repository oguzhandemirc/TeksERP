// Canlı okuma oylama/kilit: son N yanıtta ≥K aynı normalize değer → kilit; kilitli alanı okuma değiştirmez; elle düzeltme
// kilidi "user" yapar; kilit açılınca eski oylar yeniden kilitlemez; belge türü değişince panel baştan kurulur.
import { LIVE_VOTE_QUORUM, LIVE_VOTE_RELOCK, LIVE_VOTE_WINDOW } from './liveTuning';
import {
  EMPTY_VOTE,
  allLiveLocked,
  applyLiveReading,
  editLiveField,
  isLabelLikeValue,
  isLiveAbsent,
  liveFieldStatus,
  liveSuggestion,
  userLockedLiveKeys,
  lockedLiveValues,
  normalizeLiveValue,
  topVote,
  unlockLiveField,
  type LiveVoteState,
} from './liveVote';

const T = { code: 'ACME', name: 'Acme İrsaliye' };
const reading = (vals: Record<string, string | null>, template: { code: string; name: string } | null = T) => ({
  template,
  fields: Object.entries(vals).map(([key, value]) => ({ key, label: key.toUpperCase(), value })),
});
const feed = (s: LiveVoteState, list: Record<string, string | null>[]) => list.reduce((acc, v) => applyLiveReading(acc, reading(v)), s);

describe('liveVote', () => {
  it('sabitler: N=5, K=3', () => {
    expect(LIVE_VOTE_WINDOW).toBe(5);
    expect(LIVE_VOTE_QUORUM).toBe(3);
  });

  it('normalize: NFC + tek boşluk + kırpma; boş → null', () => {
    expect(normalizeLiveValue('  P-12   34 ')).toBe('P-12 34');
    expect(normalizeLiveValue('e\u0301')).toBe('\u00e9');
    expect(normalizeLiveValue('   ')).toBeNull();
    expect(normalizeLiveValue(null)).toBeNull();
  });

  it('topVote null oy saymaz; eşitlikte en yeni kazanır', () => {
    expect(topVote([null, null])).toBeNull();
    expect(topVote(['a', 'b', 'a', 'b'])).toEqual({ value: 'b', count: 2 });
  });

  it('⭐ K-1 aynı değer kilitlemez, K. aynı değer kilitler (boşluk farkı aynı sayılır)', () => {
    let s = feed(EMPTY_VOTE, [{ parti: 'P 12' }, { parti: 'P  12 ' }]);
    expect(s.fields[0].lock).toBeNull();
    expect(liveFieldStatus(s.fields[0])).toBe('candidate');
    s = applyLiveReading(s, reading({ parti: ' P 12' }));
    expect(s.fields[0].lock).toEqual({ value: 'P 12', by: 'vote' });
    expect(liveFieldStatus(s.fields[0])).toBe('locked');
  });

  it('pencere N: eski oylar düşer (5 yanıt dışındaki değer sayılmaz)', () => {
    const s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'b' }, { x: 'c' }, { x: 'd' }, { x: 'e' }, { x: 'a' }]);
    expect(s.fields[0].history).toHaveLength(LIVE_VOTE_WINDOW);
    expect(s.fields[0].lock).toBeNull();
  });

  it('null değerler oy değildir ama pencerede yer kaplar', () => {
    const s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: null }, { x: 'a' }, { x: null }, { x: 'a' }]);
    expect(s.fields[0].lock?.value).toBe('a');
    expect(liveFieldStatus(feed(EMPTY_VOTE, [{ y: null }]).fields[0])).toBe('empty');
  });

  it('kilitli alanı sonraki okuma değiştirmez', () => {
    const s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'a' }, { x: 'z' }, { x: 'z' }, { x: 'z' }]);
    expect(s.fields[0].lock?.value).toBe('a');
  });

  it('elle düzeltme kilidi user yapar; boş değer kilidi açar', () => {
    let s = feed(EMPTY_VOTE, [{ x: 'a' }]);
    s = editLiveField(s, 'x', ' 1.250 ');
    expect(s.fields[0].lock).toEqual({ value: '1.250', by: 'user' });
    s = editLiveField(s, 'x', '');
    expect(s.fields[0].lock).toBeNull();
  });

  it('kilit açılınca geçmiş silinir: eski oylar hemen yeniden kilitlemez', () => {
    let s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'a' }]);
    s = unlockLiveField(s, 'x');
    expect(s.fields[0].history).toEqual([]);
    s = applyLiveReading(s, reading({ x: 'a' }));
    expect(s.fields[0].lock).toBeNull();
  });

  it('tanınmayan kare durumu değiştirmez; belge türü değişince panel baştan', () => {
    const s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'a' }]);
    expect(applyLiveReading(s, reading({ x: 'q' }, null))).toBe(s);
    const other = applyLiveReading(s, reading({ y: 'b' }, { code: 'B', name: 'Başka' }));
    expect(other.template?.name).toBe('Başka');
    expect(other.fields.map((f) => f.key)).toEqual(['y']);
  });

  it('allLiveLocked + lockedLiveValues', () => {
    expect(allLiveLocked(EMPTY_VOTE)).toBe(false);
    let s = feed(EMPTY_VOTE, [{ x: 'a', y: 'b' }, { x: 'a', y: null }, { x: 'a', y: null }]);
    expect(allLiveLocked(s)).toBe(false);
    s = editLiveField(s, 'y', 'B-1');
    expect(allLiveLocked(s)).toBe(true);
    expect(lockedLiveValues(s)).toEqual({ x: 'a', y: 'B-1' });
  });
});

describe('liveVote — kendini düzelten kilit, belgede yok, öneri, etiket ve netlik seddi (2026-11-09)', () => {
  it('A ⭐ oy kilidi kendini düzeltir: son 5in ≥4ü kilitten farklı aynı değer → kilit geçer + "düzeltildi"', () => {
    expect(LIVE_VOTE_RELOCK).toBe(4);
    let s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'a' }]);
    expect(s.fields[0].lock).toEqual({ value: 'a', by: 'vote' });
    s = feed(s, [{ x: 'b' }, { x: 'b' }, { x: 'b' }]);
    expect(s.fields[0].lock?.value).toBe('a'); // 3 farklı yetmez
    s = applyLiveReading(s, reading({ x: 'b' }));
    expect(s.fields[0].lock).toEqual({ value: 'b', by: 'vote' });
    expect(s.fields[0].corrected).toBeGreaterThan(0);
    s = feed(s, [{ x: 'b' }, { x: 'b' }, { x: 'b' }]);
    expect(s.fields[0].corrected).toBe(0); // işaret kısa sürer
  });

  it('A ⭐ elle kilit ("user") oylamadan asla etkilenmez', () => {
    let s = editLiveField(feed(EMPTY_VOTE, [{ x: 'a' }]), 'x', 'ELLE');
    s = feed(s, [{ x: 'z' }, { x: 'z' }, { x: 'z' }, { x: 'z' }, { x: 'z' }]);
    expect(s.fields[0].lock).toEqual({ value: 'ELLE', by: 'user' });
    expect(userLockedLiveKeys(s)).toEqual(['x']);
  });

  it('B ⭐ son 5 yanıtın hiçbirinde değer yok → "Belgede yok", tamam sayılır; değer gelince oylamaya döner', () => {
    let s = feed(EMPTY_VOTE, [{ cins: null, m: 'a' }, { cins: null, m: 'a' }, { cins: null, m: 'a' }, { cins: null, m: 'a' }]);
    expect(liveFieldStatus(s.fields[0])).toBe('empty'); // 4 yanıt: henüz değil
    s = applyLiveReading(s, reading({ cins: null, m: 'a' }));
    expect(isLiveAbsent(s.fields[0])).toBe(true);
    expect(liveFieldStatus(s.fields[0])).toBe('absent');
    expect(allLiveLocked(s)).toBe(true);
    expect(lockedLiveValues(s)).toEqual({ m: 'a' }); // forma değer yazmaz
    s = applyLiveReading(s, reading({ cins: 'Saten', m: 'a' }));
    expect(liveFieldStatus(s.fields[0])).toBe('candidate');
    expect(allLiveLocked(s)).toBe(false);
  });

  it('C kilitli alanda son kareler farklıysa öneri; dokununca elle kilit', () => {
    let s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }, { x: 'a' }]);
    expect(liveSuggestion(s.fields[0])).toBeNull();
    s = feed(s, [{ x: 'b' }]);
    expect(liveSuggestion(s.fields[0])).toBeNull(); // tek kare gürültü
    s = feed(s, [{ x: 'b' }]);
    expect(liveSuggestion(s.fields[0])).toBe('b');
    s = editLiveField(s, 'x', 'b');
    expect(s.fields[0].lock).toEqual({ value: 'b', by: 'user' });
    expect(liveSuggestion(s.fields[0])).toBeNull();
  });

  it('E etiket-benzeri değer oy değildir (yalnız harf + ":" / bilinen başlık sözcükleri); gerçek değer geçer', () => {
    for (const v of ['TARİH', 'Tarih:', 'MÜŞTERİ', 'Cinsi :', 'PARTİ NO', 'tarih']) expect(isLabelLikeValue(v)).toBe(true);
    for (const v of ['Saten', 'P-12', '1.250', 'Lacivert', 'No: 12', 'KIRMIZI']) expect(isLabelLikeValue(v)).toBe(false);
    const s = feed(EMPTY_VOTE, [{ x: 'TARİH' }, { x: 'TARİH' }, { x: 'TARİH' }]);
    expect(s.fields[0].lock).toBeNull();
    expect(s.fields[0].history).toEqual([null, null, null]);
  });

  it('F bulanık kare oy değildir: geçmişe eklenmez (pencere kaymaz), aday görünür', () => {
    let s = feed(EMPTY_VOTE, [{ x: 'a' }, { x: 'a' }]);
    s = applyLiveReading(s, reading({ x: 'q' }), { counts: false });
    s = applyLiveReading(s, reading({ x: 'q' }), { counts: false });
    s = applyLiveReading(s, reading({ x: 'q' }), { counts: false });
    expect(s.fields[0].history).toEqual(['a', 'a']);
    expect(s.fields[0].candidate).toBe('q');
    expect(s.fields[0].lock).toBeNull();
    s = applyLiveReading(s, reading({ x: 'a' }));
    expect(s.fields[0].lock?.value).toBe('a');
  });
});
