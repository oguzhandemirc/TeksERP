import { effectiveOwnershipScope, ownerBadgeOf, ownershipFilter, OWNERSHIP_TABS } from './ownership';

describe('mülkiyet saf kuralları (T3)', () => {
  it('emanet kapalıyken seçim ne olursa olsun ALL (kalan "Emanet" seçimi listeyi daraltmaz)', () => {
    expect(effectiveOwnershipScope(false, 'CONSIGNED')).toBe('ALL');
    expect(effectiveOwnershipScope(false, 'OWN')).toBe('ALL');
    expect(effectiveOwnershipScope(true, 'CONSIGNED')).toBe('CONSIGNED');
  });

  it('ALL parametre üretmez (eski istekle aynı); OWN/CONSIGNED sunucu değerini yollar', () => {
    expect(ownershipFilter('ALL')).toEqual({});
    expect(ownershipFilter('OWN')).toEqual({ mulkiyet: 'OWN' });
    expect(ownershipFilter('CONSIGNED')).toEqual({ mulkiyet: 'CONSIGNED' });
  });

  it('sekmeler Tümü / Bizim / Emanet sırasıyla, sunucu değerleriyle', () => {
    expect(OWNERSHIP_TABS.map((t) => `${t.key}:${t.label}`)).toEqual(['ALL:Tümü', 'OWN:Bizim', 'CONSIGNED:Emanet']);
  });

  it('rozet: yalnız emanet açık + sahipli topta; ad yoksa (eski sunucu) adsız rozet', () => {
    const owned = { ownerCustomerId: 'c1', ownerCustomer: { id: 'c1', name: ' Akın Tekstil ' } };
    expect(ownerBadgeOf(false, owned)).toBeNull();
    expect(ownerBadgeOf(true, owned)).toEqual({ name: 'Akın Tekstil' });
    expect(ownerBadgeOf(true, { ownerCustomerId: 'c1' })).toEqual({ name: null });
    expect(ownerBadgeOf(true, { ownerCustomerId: null, ownerCustomer: null })).toBeNull();
    expect(ownerBadgeOf(true, {})).toBeNull();
  });
});
