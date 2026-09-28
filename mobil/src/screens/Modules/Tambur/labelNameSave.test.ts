// =============================================================================
// "Kalıcı" düzeltme planı + renk rozeti — MUSTERI-KUMAS-RENK-ADI §12.6 (D4)
// =============================================================================
// Tablet 1.0.8 sızıntısı: kalıcı kayıt renk alanını KOŞULSUZ genel ada yazıyordu;
// çözülmüş ad kumaşa özel olabildiği için X kumaşının adı müşterinin bütün
// kumaşlarına sızardı. Bu dosya planın iki yarısını ölçer: yalnız değişen alan
// yazılır ve renk kazanan kademeye yazılır.
// =============================================================================
import {
  colorSourceLabel,
  masterChanged,
  partialFailureMessage,
  planPermanentWrites,
  sourceSummary,
} from './labelNameSave';

const base = {
  customerId: 'c1',
  itemId: 'i1',
  itemName: 'PAMUKLU ASTAR',
  colorId: 'k1',
  colorName: 'ABC',
};

describe('planPermanentWrites — yalnız değişen alan', () => {
  it('yalnız kumaş adı değişirse renk YAZILMAZ (1.0.8 sızıntısı)', () => {
    const plan = planPermanentWrites(
      { ...base, colorNameScope: 'ITEM' },
      { itemName: 'COTTON LINING', colorName: 'ABC' },
    );
    expect(plan).toEqual([{ kind: 'ITEM_ALIAS', customerId: 'c1', itemId: 'i1', alias: 'COTTON LINING' }]);
  });

  it('yalnız renk değişirse kumaş adı YAZILMAZ', () => {
    const plan = planPermanentWrites(base, { itemName: 'PAMUKLU ASTAR', colorName: 'SAND' });
    expect(plan.map((w) => w.kind)).toEqual(['COLOR_ALIAS']);
  });

  it('hiçbir şey değişmediyse plan boş', () => {
    expect(planPermanentWrites(base, { itemName: 'PAMUKLU ASTAR', colorName: 'ABC' })).toEqual([]);
  });

  it('boşluk farkı değişiklik sayılmaz', () => {
    expect(planPermanentWrites(base, { itemName: '  PAMUKLU ASTAR ', colorName: ' ABC' })).toEqual([]);
  });

  it('boş değer gönderilmez (adı silmek panelin işi)', () => {
    expect(planPermanentWrites(base, { itemName: '', colorName: '  ' })).toEqual([]);
  });

  it('renksiz topta renk yazılmaz', () => {
    const plan = planPermanentWrites({ ...base, colorId: null, colorName: null }, { itemName: 'PAMUKLU ASTAR', colorName: 'X' });
    expect(plan).toEqual([]);
  });

  it('müşteri yoksa (stok) hiçbir şey yazılmaz', () => {
    expect(planPermanentWrites({ ...base, customerId: null }, { itemName: 'Y', colorName: 'Z' })).toEqual([]);
  });

  it('renk adı önceden yoksa (null) girilen ad değişiklik sayılır', () => {
    const plan = planPermanentWrites({ ...base, colorName: null }, { itemName: 'PAMUKLU ASTAR', colorName: 'BEJ' });
    expect(plan.map((w) => w.kind)).toEqual(['COLOR_ALIAS']);
  });
});

describe('planPermanentWrites — renk kazanan kademeye', () => {
  it("colorNameScope='ITEM' → kumaşa özel satır güncellenir", () => {
    const plan = planPermanentWrites({ ...base, colorNameScope: 'ITEM' }, { itemName: 'PAMUKLU ASTAR', colorName: 'XYZ' });
    expect(plan).toEqual([
      { kind: 'ITEM_COLOR_ALIAS', customerId: 'c1', itemId: 'i1', colorId: 'k1', alias: 'XYZ' },
    ]);
  });

  it.each([
    ['CUSTOMER', 'CUSTOMER' as const],
    ['null', null],
    ['alan yok (eski backend)', undefined],
  ])('colorNameScope=%s → genel ad (bugünkü davranış)', (_ad, scope) => {
    const plan = planPermanentWrites({ ...base, colorNameScope: scope }, { itemName: 'PAMUKLU ASTAR', colorName: 'XYZ' });
    expect(plan).toEqual([{ kind: 'COLOR_ALIAS', customerId: 'c1', colorId: 'k1', alias: 'XYZ' }]);
  });

  it('bilinmeyen kademe değeri genel ada gider (kumaşa özel satır YARATILMAZ)', () => {
    const plan = planPermanentWrites(
      { ...base, colorNameScope: 'BRANCH' as unknown as 'ITEM' },
      { itemName: 'PAMUKLU ASTAR', colorName: 'XYZ' },
    );
    expect(plan.map((w) => w.kind)).toEqual(['COLOR_ALIAS']);
  });

  it('ikisi de değişirse önce kumaş, sonra renk', () => {
    const plan = planPermanentWrites({ ...base, colorNameScope: 'ITEM' }, { itemName: 'N', colorName: 'M' });
    expect(plan.map((w) => w.kind)).toEqual(['ITEM_ALIAS', 'ITEM_COLOR_ALIAS']);
  });
});

describe('renk rozeti', () => {
  it("MASTER + ITEM → 'bu kumaşa özel'", () => {
    expect(colorSourceLabel('MASTER', 'ITEM')).toBe('müşteri adı · bu kumaşa özel');
  });

  it.each([['CUSTOMER'], [null], [undefined], ['BRANCH']])('MASTER + %s → müşteri adı', (scope) => {
    expect(colorSourceLabel('MASTER', scope as 'ITEM' | null)).toBe('müşteri adı');
  });

  it('OVERRIDE/DEFAULT kademeden etkilenmez', () => {
    expect(colorSourceLabel('OVERRIDE', 'ITEM')).toBe('siparişe özel');
    expect(colorSourceLabel('DEFAULT', 'ITEM')).toBe('bizdeki ad');
  });

  it('özet: renk rozeti kumaşınkiyle aynıysa tekrar yazılmaz', () => {
    expect(
      sourceSummary({ itemNameSource: 'MASTER', colorName: 'ABC', colorNameSource: 'MASTER', colorNameScope: 'CUSTOMER' }),
    ).toBe('müşteri adı');
  });

  it('özet: renk kumaşa özelse ayrıca yazılır', () => {
    expect(
      sourceSummary({ itemNameSource: 'DEFAULT', colorName: 'ABC', colorNameSource: 'MASTER', colorNameScope: 'ITEM' }),
    ).toBe('bizdeki ad · renk: müşteri adı · bu kumaşa özel');
  });

  it('özet: renksiz topta yalnız kumaş rozeti', () => {
    expect(sourceSummary({ itemNameSource: 'OVERRIDE', colorName: null, colorNameSource: null })).toBe('siparişe özel');
  });
});

describe('masterChanged — açılışta görülen ana veri kayıt anında aynı mı', () => {
  const seen = { itemName: 'PAMUKLU ASTAR', colorName: 'ABC', colorNameScope: 'CUSTOMER' as const };

  it('aynıysa değişmedi', () => {
    expect(masterChanged(seen, { ...seen })).toBe(false);
  });

  it('eksik kademe alanı null sayılır (eski backend)', () => {
    expect(masterChanged({ itemName: 'A', colorName: null }, { itemName: 'A', colorName: null, colorNameScope: null })).toBe(false);
  });

  it.each([
    ['kademe (panel kumaşa özel ad girdi)', { colorNameScope: 'ITEM' as const }],
    ['renk adı', { colorName: 'DEF' }],
    ['kumaş adı', { itemName: 'COTTON' }],
  ])('%s değiştiyse değişti', (_ad, fark) => {
    expect(masterChanged(seen, { ...seen, ...fark })).toBe(true);
  });
});

describe('partialFailureMessage — sıralı yazımda hangisi geçti', () => {
  it('ilk yazım düştüyse yalnız sebep', () => {
    expect(partialFailureMessage([], 'ITEM_ALIAS', 'Ağ hatası')).toBe('Ağ hatası');
  });

  it('kumaş geçti, renk düştü', () => {
    expect(partialFailureMessage(['ITEM_ALIAS'], 'ITEM_COLOR_ALIAS', 'Kumaş pasif')).toBe(
      'Kumaş adı kaydedildi, renk adı kaydedilemedi: Kumaş pasif',
    );
  });
});
