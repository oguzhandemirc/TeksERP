// Rehberli tanıtma saf çekirdeği (guided.ts): adım ↔ alan, başlık satırı aç/kapa, çok kelimeli değer, kutu tonları,
// okunan değer durumları, çip durumu, ad önerisi.
import type { ScanWord, ScanWords, SuggestResult } from '../../../../types/inboundDocTeach';
import { chipStatus, fieldLabel, fieldReadout, FINISH_STEP, GUIDED_FIELDS, guidedMarks, stepField, suggestName, toggleFieldWord, toggleHeaderWord } from './guided';
import { initialTeach, type TeachState } from './teachDraft';

const w = (text: string, [x, y]: [number, number], lineNo: number, width = 60): ScanWord => ({
  text, rect: { x, y, width, height: 20 }, photoRect: { x, y, width, height: 20 }, lineNo, confidence: 0.99,
});
const SCAN: ScanWords = {
  imageWidth: 1000, imageHeight: 1500, rotation: 0,
  words: [
    w('GÜLEÇSOY', [50, 20], 1, 120), w('BOYA', [180, 20], 1), w('ÇEKİ', [50, 60], 2), w('LİSTESİ', [120, 60], 2),
    w('Ham', [50, 300], 3), w('PartiNo:', [100, 300], 3), w('P2618733', [200, 300], 3, 90), w('Desen', [50, 400], 4), w('KAR', [150, 400], 4), w('ÇİÇEĞİ', [200, 400], 4),
  ],
};
const start = (): TeachState => initialTeach(SCAN, suggestName(SCAN));
const on = (s: TeachState) => s.identifiers.filter((d) => d.on).map((d) => d.text);
const result = (over: Partial<SuggestResult> = {}): SuggestResult =>
  ({
    template: {},
    explain: [{ field: 'partiNo', strategy: 'anchor', label: 'Ham PartiNo', direction: 'right' }],
    errors: [],
    preview: { matched: true, score: 1, fields: { partiNo: 'P2618733', desen: '' }, lineCount: 0, warnings: [] },
    ...over,
  }) as SuggestResult;

describe('guided — adımlar', () => {
  it('adım 0 başlık, 1..n sözleşme sırasındaki alanlar, son adım Bitir', () => {
    expect(GUIDED_FIELDS).toEqual(['musteri', 'partiNo', 'hedefMetraj', 'toplamMetre', 'en', 'desen', 'renk', 'evrakNo']);
    expect(stepField(0)).toBeNull();
    expect(stepField(1)).toBe('musteri');
    expect(stepField(2)).toBe('partiNo');
    expect(stepField(GUIDED_FIELDS.length)).toBe('evrakNo');
    expect(fieldLabel('evrakNo')).toBe('Evrak no');
    expect(FINISH_STEP).toBe(GUIDED_FIELDS.length + 1);
    expect(stepField(FINISH_STEP)).toBeNull();
    expect(fieldLabel('partiNo')).toBe('Parti no');
    expect(fieldLabel('musteri')).toMatch(/Müşteri/);
  });

  it('ad önerisi belgenin ilk başlık satırı', () => {
    expect(suggestName(SCAN)).toBe('GÜLEÇSOY BOYA');
    expect(suggestName({ ...SCAN, words: [] })).toBe('');
  });
});

describe('guided — başlık adımı', () => {
  it('dokunulan kelimenin SATIRI kimlik olarak kapanır / açılır; yeni satır eklenir', () => {
    let s = start();
    expect(on(s)).toEqual(expect.arrayContaining(['GÜLEÇSOY BOYA', 'ÇEKİ LİSTESİ']));
    s = toggleHeaderWord(s, SCAN.words, 1); // BOYA → "GÜLEÇSOY BOYA" satırı kapanır
    expect(on(s)).not.toContain('GÜLEÇSOY BOYA');
    s = toggleHeaderWord(s, SCAN.words, 0);
    expect(on(s)).toContain('GÜLEÇSOY BOYA');
    // Öneride olmayan satır (sondaki ":" temizlenir) eklenir.
    const without: TeachState = { ...s, identifiers: s.identifiers.filter((d) => !/Ham/.test(d.text)) };
    s = toggleHeaderWord(without, SCAN.words, 5);
    expect(s.identifiers).toHaveLength(without.identifiers.length + 1);
    expect(on(s)).toContain('Ham PartiNo: P2618733');
  });

  it('kutu tonları: başlık adımında açık kimlik satırları "Başlık"; alan adımında yalnız o alanın değeri seçili', () => {
    let s = start();
    const m0 = guidedMarks(s, SCAN.words, 0);
    expect(m0[0]).toMatchObject({ tone: 'identifier', label: 'Başlık' });
    expect(m0[1]).toMatchObject({ tone: 'identifier' });
    s = toggleFieldWord(s, SCAN.words, 'partiNo', 6);
    const m2 = guidedMarks(s, SCAN.words, 2);
    expect(m2[6]).toMatchObject({ tone: 'selected', label: 'Parti no' });
    expect(m2[0].tone).toBe('word');
    // Başka alan adımında parti no değeri "atanmış alan" tonunda kalır.
    expect(guidedMarks(s, SCAN.words, 6)[6].tone).toBe('field');
  });
});

describe('guided — alan adımı', () => {
  it('çok kelimeli değer: dokunuşlar eklenir, tekrar dokunuş çıkarır, son kelime çıkınca alan silinir', () => {
    let s = start();
    s = toggleFieldWord(s, SCAN.words, 'desen', 8);
    s = toggleFieldWord(s, SCAN.words, 'desen', 9);
    expect(s.fields.desen).toEqual([8, 9]);
    s = toggleFieldWord(s, SCAN.words, 'desen', 8);
    expect(s.fields.desen).toEqual([9]);
    s = toggleFieldWord(s, SCAN.words, 'desen', 9);
    expect(s.fields.desen).toBeUndefined();
    expect(s.selected).toEqual([]);
  });

  it('okunan değer: işaret yok → idle; bayat → loading; taze → değer + etiket; boş → empty; hata önce gelir', () => {
    let s = start();
    expect(fieldReadout(s, 'partiNo', { result: null, fresh: false, error: null })).toEqual({ kind: 'idle' });
    s = toggleFieldWord(s, SCAN.words, 'partiNo', 6);
    expect(fieldReadout(s, 'partiNo', { result: result(), fresh: false, error: null })).toEqual({ kind: 'loading' });
    expect(fieldReadout(s, 'partiNo', { result: result(), fresh: true, error: null })).toEqual({ kind: 'ok', value: 'P2618733', label: 'Ham PartiNo' });
    expect(fieldReadout(s, 'partiNo', { result: null, fresh: false, error: 'Ağ hatası' })).toEqual({ kind: 'error', text: 'Ağ hatası' });
    // Eksik (ör. kimlik yazısı yok) önizlemeyi engelliyorsa sonsuz "okunuyor" yerine neden söylenir.
    expect(fieldReadout(s, 'partiNo', { result: null, fresh: false, error: null, blocked: 'En az bir kimlik yazısı işaretleyin' })).toEqual({
      kind: 'error',
      text: 'Değer, şu eksik tamamlanınca okunur: En az bir kimlik yazısı işaretleyin',
    });
    expect(fieldReadout({ ...s, fields: {} }, 'partiNo', { result: null, fresh: false, error: null, blocked: 'x' })).toEqual({ kind: 'idle' });
    expect(fieldReadout(s, 'partiNo', { result: result({ errors: ['Kutu boş'] }), fresh: true, error: null })).toEqual({ kind: 'error', text: 'Kutu boş' });
    const pos = result({ explain: [{ field: 'partiNo', strategy: 'region' } as never] });
    expect(fieldReadout(s, 'partiNo', { result: pos, fresh: true, error: null })).toEqual({ kind: 'ok', value: 'P2618733', label: null });
    s = toggleFieldWord(s, SCAN.words, 'desen', 8);
    expect(fieldReadout(s, 'desen', { result: result(), fresh: true, error: null })).toEqual({ kind: 'empty' });
  });

  it('çip durumu: işaretli → done, "Bu belgede yok" → skipped, aksi todo', () => {
    const s = toggleFieldWord(start(), SCAN.words, 'partiNo', 6);
    expect(chipStatus(s, 'partiNo', ['partiNo'])).toBe('done');
    expect(chipStatus(s, 'musteri', ['musteri'])).toBe('skipped');
    expect(chipStatus(s, 'renk', [])).toBe('todo');
  });
});
