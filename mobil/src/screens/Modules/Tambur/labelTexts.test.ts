// Etiket kumaş adı / renk saf kararları: kapsam sıfırlama, `last` tohumu (bir kez, girişi ezmez),
// gövde (boş alan HİÇ gitmez = bugünkü gövde), özet satırı ve silik ipucu.
import {
  LABEL_TEXT_MAX,
  emptyHint,
  initialLabelTexts,
  labelSummaryText,
  labelTextsBody,
  withSeed,
  withTexts,
  withTextsScope,
} from './labelTexts';

describe('labelTexts', () => {
  it('boş değer gövdeye hiç girmez; dolu değer kırpılır, 80 ile sınırlanır', () => {
    expect(labelTextsBody({ itemName: '', colorName: '   ' })).toEqual({});
    expect(labelTextsBody({ itemName: '  sultan  ipek ', colorName: 'ekru' })).toEqual({ labelItemName: 'sultan ipek', labelColorName: 'ekru' });
    expect(labelTextsBody({ itemName: 'x'.repeat(100), colorName: '' }).labelItemName).toHaveLength(LABEL_TEXT_MAX);
  });

  it('kapsam değişince sıfırlanır, aynı kapsamda aynı nesne', () => {
    const s = withTexts(initialLabelTexts('wo1'), { itemName: 'A', colorName: 'B' });
    expect(withTextsScope(s, 'wo1')).toBe(s);
    expect(withTextsScope(s, 'wo2')).toEqual(initialLabelTexts('wo2'));
  });

  it('tohum bir kez uygulanır ve operatör girişini ezmez', () => {
    const last = { itemName: 'SULTAN', colorName: null, batchNo: 'P1' };
    const seeded = withSeed(initialLabelTexts('wo1'), last);
    expect(seeded).toMatchObject({ itemName: 'SULTAN', colorName: '', seeded: true });
    expect(withSeed({ ...seeded, itemName: 'LALE' }, { itemName: 'X', colorName: 'Y', batchNo: null }).itemName).toBe('LALE');
    const typed = withSeed(withTexts(initialLabelTexts('wo1'), { itemName: 'ELLE', colorName: '' }), last);
    expect(typed.itemName).toBe('ELLE');
    expect(withSeed(initialLabelTexts('wo1'), null)).toMatchObject({ itemName: '', seeded: true });
  });

  it('özet satırı: değer → kaynak değer → genel metin; parti yalnız ayar açıkken', () => {
    expect(labelSummaryText({ itemName: 'SULTAN', colorName: 'EKRU', batchNo: 'P1', batchEnabled: true })).toBe('Etiket: SULTAN · EKRU · P1');
    expect(labelSummaryText({ itemName: 'SULTAN', colorName: 'EKRU', batchNo: 'P1', batchEnabled: false })).toBe('Etiket: SULTAN · EKRU');
    expect(labelSummaryText({ itemName: '', colorName: '', batchNo: '', batchEnabled: true, defaults: { itemName: 'PATOS', colorName: 'MAVİ' } }))
      .toBe('Etiket: PATOS · MAVİ');
    expect(labelSummaryText({ itemName: '', colorName: '', batchNo: '', batchEnabled: false })).toBe('Etiket: kumaşın adı');
  });

  it('silik ipucu', () => {
    expect(emptyHint('EMANET KUMAŞ', 'kumaşın kendi adı')).toBe('Boş: EMANET KUMAŞ');
    expect(emptyHint(null, 'kumaşın kendi adı')).toBe('Boş: kumaşın kendi adı');
  });
});
