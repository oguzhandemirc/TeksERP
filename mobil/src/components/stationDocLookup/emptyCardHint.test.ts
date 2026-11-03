import { emptyCardHint } from './emptyCardHint';

describe('emptyCardHint', () => {
  it('⭐ hiçbir kipte "refakat" demez (belge gezen fabrika)', () => {
    for (const compact of [true, false])
      for (const docLookupEnabled of [true, false])
        expect(emptyCardHint({ compact, docLookupEnabled, where: 'Sağ üstten' })).not.toMatch(/refakat/i);
  });
  it('belge okutma açıksa belgeyi de önerir', () => {
    expect(emptyCardHint({ compact: false, docLookupEnabled: true, where: 'Sağdan' })).toBe('Sağdan kart ya da belge okutarak başlayın');
    expect(emptyCardHint({ compact: false, docLookupEnabled: false, where: 'Sağdan' })).toBe('Sağdan kart okutarak başlayın');
  });
});
