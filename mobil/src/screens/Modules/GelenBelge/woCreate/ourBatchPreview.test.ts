// Seri kipinde bizim parti no metni + sunucu yanıtından ardışık tahmin. Negatif sonda: `nextCodes` yokken `nextCode`a
// düşülmezse eski sunucuda ilk parti "Otomatik" kalır; kapalı rejimde tahmin dönerse kapalı sayaç numara uydurur.
import { batchPreviewPlan, ourBatchAutoText, previewCodes } from './ourBatchPreview';

const st = (p: object) => ({ enabled: true, lastCode: 'P04', nextCode: 'P05', min: 1, max: 99, ...p });

describe('ourBatchPreview', () => {
  it('⭐ tahmin varsa "Otomatik · sıradaki: X", yoksa yalnız "Otomatik"', () => {
    expect(ourBatchAutoText('P05')).toBe('Otomatik · sıradaki: P05');
    expect(ourBatchAutoText(undefined)).toBe('Otomatik');
    expect(ourBatchAutoText(null)).toBe('Otomatik');
    expect(ourBatchAutoText('')).toBe('Otomatik');
  });
  it('⭐ yeni sunucu ardışık nextCodes, eski sunucu yalnız nextCode', () => {
    expect(previewCodes(st({ nextCodes: ['P05', 'P06', 'P07'] }))).toEqual(['P05', 'P06', 'P07']);
    expect(previewCodes(st({}))).toEqual(['P05']);
  });
  it('kapalı rejim / boş yanıt → tahmin yok', () => {
    expect(previewCodes(st({ enabled: false, nextCodes: ['P05'] }))).toEqual([]);
    expect(previewCodes(st({ nextCode: null }))).toEqual([]);
    expect(previewCodes(undefined)).toEqual([]);
  });
  it('⭐ çok parti: SINGLE tek numara, PER_PARTY açılmamış parti sayısı kadar; açılacak yoksa 0', () => {
    expect(batchPreviewPlan('SINGLE', [1, 2, 3])).toEqual({ count: 1, perParty: false });
    expect(batchPreviewPlan('PER_PARTY', [1, 2, 3])).toEqual({ count: 3, perParty: true });
    expect(batchPreviewPlan('PER_PARTY', [3])).toEqual({ count: 1, perParty: true });
    expect(batchPreviewPlan('SINGLE', [])).toEqual({ count: 0, perParty: false });
  });
});
