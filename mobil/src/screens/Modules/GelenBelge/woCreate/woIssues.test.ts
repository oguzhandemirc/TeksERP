// Engel sözlüğü: alt çubuk hapları (anahtar başına bir, kısa ad) + şerit tonu (sarı = düzeltilecek değer, kırmızı = eksik).
import { initialRowForm, rowIssueList, rowIssues } from './woFromDoc';
import { bandTone, missingChips, TARGET_ISSUE_KEYS, TARGET_WARN_KEYS, type FormIssue } from './woIssues';

const detail = { kursunMeters: null, kursunMetersReview: false, ownerCustomerId: null, ownerSuggestion: null } as unknown as Parameters<typeof initialRowForm>[0];

describe('missingChips', () => {
  it('⭐ anahtar başına tek hap, kısa ad, ilk sıra korunur', () => {
    const issues: FormIssue[] = [
      { key: 'musteri', text: 'Müşteriyi seçin.' },
      { key: 'kursunMetresi', text: 'Top metresi eksik: 1. top.' },
      { key: 'kursunMetresi', text: 'En fazla 30 top girilebilir.' },
      { key: 'katTipi', text: 'Kat tipini seçin.' },
    ];
    expect(missingChips(issues)).toEqual([
      { key: 'musteri', text: 'Müşteri seçilmedi' },
      { key: 'kursunMetresi', text: 'Metre yok' },
      { key: 'katTipi', text: 'Kat tipi' },
    ]);
  });
  it('sözlükte kısa adı olmayan anahtar uzun metne düşer', () => {
    expect(missingChips([{ key: 'not', text: 'Not hatalı.' }])).toEqual([{ key: 'not', text: 'Not hatalı.' }]);
  });
});

describe('rowIssueList', () => {
  it('⭐ müşteri + metre engelleri alana bağlı; düz liste aynı metinler', () => {
    const f = { ...initialRowForm(detail), ownerCustomerId: null, meters: null };
    expect(rowIssueList(f).map((i) => i.key)).toEqual(['musteri', 'kursunMetresi']);
    expect(rowIssues(f)).toEqual(['Müşteriyi seçin.', 'Kurşun metresi yok — metreyi girin.']);
    expect(rowIssueList({ ...f, ownerCustomerId: 'c1', meters: 10, metersReview: true })).toEqual([
      { key: 'metreDogrula', text: 'Kurşun metresini doğrulayın ya da düzeltin.' },
    ]);
  });
});

describe('bandTone', () => {
  const opts = { keys: TARGET_ISSUE_KEYS, warnKeys: TARGET_WARN_KEYS };
  it('⭐ Hedef şeridi: sayı hatası sarı, kat eksik kırmızı, ikisi birden kırmızı, yoksa durumsuz', () => {
    expect(bandTone([{ key: 'en', text: 'x' }], opts)).toBe('warn');
    expect(bandTone([{ key: 'katTipi', text: 'x' }], opts)).toBe('missing');
    expect(bandTone([{ key: 'en', text: 'x' }, { key: 'katTipi', text: 'y' }], opts)).toBe('missing');
    expect(bandTone([{ key: 'musteri', text: 'x' }], opts)).toBe('idle');
    expect(bandTone([], { ...opts, done: true })).toBe('ok');
  });
});
