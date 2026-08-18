// =============================================================================
// LabelNamePreview — "Bizde:" referans satırının GÖRÜNME kuralı (2026-08-19)
// =============================================================================
// Saha isteği: müşteriye özel ad basılırken "bu aslında hangi kumaştı" ekranda
// hiç yoktu (depoda/rafta kumaş BİZDEKİ adla duruyor). Fark varken alt satırda
// soluk bir referans gösterilir.
//
// ⚠️ Kural tek cümle ama iki yönlü: fark VARSA çizilir, YOKSA çizilmez. İkinci
// yarısı kolayca kaybolur ve kaybolduğunda özellik sessizce zarar verir — aynı
// ad iki kez yazılınca operatör satırı okumamayı öğrenir, sonra GERÇEK fark da
// gözden kaçar.
// =============================================================================

import { shouldShowOriginalName } from './labelNameCompare';

const base = {
  customerId: 'c1',
  itemName: 'PAMUKLU ASTAR',
  itemNameDefault: 'PAMUKLU ASTAR',
  colorName: 'BEJ',
  colorNameDefault: 'BEJ',
};

describe('LabelNamePreview — "Bizde:" satırı', () => {
  it('ad da renk de aynıysa ÇİZİLMEZ (gürültü olurdu)', () => {
    expect(shouldShowOriginalName(base)).toBe(false);
  });

  it('kumaş adı müşteride farklıysa çizilir', () => {
    expect(shouldShowOriginalName({ ...base, itemName: 'COTTON LINING' })).toBe(true);
  });

  it('YALNIZ renk farklıysa da çizilir', () => {
    // Kolay kaçan durum: kumaş adı aynı, renk müşteride başka anılıyor.
    expect(shouldShowOriginalName({ ...base, colorName: 'SAND' })).toBe(true);
  });

  it('boşluk farkı FARK SAYILMAZ', () => {
    expect(shouldShowOriginalName({ ...base, itemName: '  PAMUKLU ASTAR  ' })).toBe(false);
  });

  it('renk yokken null ↔ boş string fark sayılmaz', () => {
    expect(
      shouldShowOriginalName({ ...base, colorName: null, colorNameDefault: null }),
    ).toBe(false);
  });

  it('STOK baskısında (müşteri yok) hiç çizilmez', () => {
    // Müşteriye özel ad zaten basılmıyor → karşılaştırılacak bir şey yok.
    expect(
      shouldShowOriginalName({ ...base, customerId: null, itemName: 'BAŞKA' }),
    ).toBe(false);
  });
});
