import {
  LABEL_BATCH_MAX,
  initialLabelBatch,
  labelBatchBody,
  labelBatchStripParts,
  labelBatchStripText,
  labelBatchWarning,
  normalizeLabelBatch,
  withScope,
  withUse,
  withValue,
} from './labelBatch';

describe('tambur müşteri parti no (labelBatch)', () => {
  it('yapışkan: kapsam aynıysa değer ve sayaç korunur (aynı nesne)', () => {
    const s = withUse(withValue(initialLabelBatch('ie-1'), 'J1'), 'J1');
    expect(withScope(s, 'ie-1')).toBe(s);
    expect(s.count).toBe(1);
  });

  it('iş emri değişince değer ve sayaç sıfırlanır', () => {
    const s = withUse(withValue(initialLabelBatch('ie-1'), 'J1'), 'J1');
    const n = withScope(s, 'ie-2');
    expect(n).toEqual({ scopeKey: 'ie-2', value: '', count: 0, auto: false, touched: false });
  });

  it('sayaç: başarılı kesimde artar, değer değişince sıfırlanır, boşluk farkı değişiklik sayılmaz', () => {
    let s = withValue(initialLabelBatch('ie-1'), 'J1');
    s = withUse(s, 'J1');
    s = withUse(s, 'J1');
    expect(s.count).toBe(2);
    expect(labelBatchStripText(s)).toBe('Etikete basılacak parti: J1 · bu değerle 3. top');
    expect(withValue(s, ' J1 ').count).toBe(2);
    s = withValue(s, 'K30');
    expect(s.count).toBe(0);
    expect(labelBatchStripText(s)).toBe('Etikete basılacak parti: K30 · bu değerle 1. top');
  });

  it('arada değer değiştiyse eski değerle dönen başarı sayılmaz', () => {
    const s = withValue(initialLabelBatch(null), 'K30');
    expect(withUse(s, 'J1')).toBe(s);
    expect(withUse(s, null)).toBe(s);
  });

  it('boşsa uyarı verir (durdurmaz); ayar kapalıyken uyarı yok', () => {
    const s = initialLabelBatch('ie-1');
    expect(labelBatchWarning(true, s)).toMatch(/Parti boş/);
    expect(labelBatchWarning(false, s)).toBeNull();
    expect(labelBatchWarning(true, withValue(s, 'J1'))).toBeNull();
    expect(labelBatchStripText(s)).toBe('Etikete basılacak parti: —');
  });

  it('gövde: ayar kapalıyken undefined (alan gitmez), açıkken trim edilmiş metin ya da null', () => {
    const s = withValue(initialLabelBatch('ie-1'), '  J1 ');
    expect(labelBatchBody(false, s)).toBeUndefined();
    expect(labelBatchBody(true, s)).toBe('J1');
    expect(labelBatchBody(true, withValue(s, '   '))).toBeNull();
  });

  it('64 karakter sınırı', () => {
    const long = 'x'.repeat(80);
    expect(withValue(initialLabelBatch(null), long).value).toHaveLength(LABEL_BATCH_MAX);
    expect(normalizeLabelBatch(long)).toHaveLength(LABEL_BATCH_MAX);
  });

  it('şerit parçaları: değer ve sayaç ayrı; boş değerde ikisi de null', () => {
    const s = withUse(withValue(initialLabelBatch('ie-1'), ' J1 '), 'J1');
    expect(labelBatchStripParts(s)).toEqual({ value: 'J1', countText: 'bu değerle 2. top' });
    expect(labelBatchStripParts(initialLabelBatch('ie-1'))).toEqual({ value: null, countText: null });
  });
});
