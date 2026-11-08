import type { ProductionRoute } from '../../../services/route.service';
import { SCAN_ROUTE_ID } from '../GelenBelge/woCreate/woFromDoc';
import { defaultType, resolveType, scanWoType, typeGroups } from './scanFlow';

const r = (id: string, name: string, over: Partial<ProductionRoute> = {}): ProductionRoute => ({ id, name, steps: [], ...over }) as ProductionRoute;
const all = [r('b', 'Boya'), r('a', 'Apre'), r('p', 'Pasif', { isActive: false }), r('k', 'Kısayol', { isWorkOrderShortcut: true, shortcutOrder: 1 })];
const shortcuts = [r('k', 'Kısayol', { isWorkOrderShortcut: true, shortcutOrder: 1 })];

describe('İş emri türü grupları', () => {
  it('Okutmayla: özel grup rotasız + kısayollar; hazır rotalar = kalan aktifler (ad sırası); varsayılan rotasız', () => {
    const g = typeGroups(all, shortcuts, true);
    expect(g.special.map((x) => x.id)).toEqual([SCAN_ROUTE_ID, 'k']);
    expect(g.ready.map((x) => x.id)).toEqual(['a', 'b']);
    expect(defaultType(g, true)?.id).toBe(SCAN_ROUTE_ID);
  });

  it('Sıralı: rotasız SUNULMAZ (sunucu 400 verir); varsayılan ilk hazır rota', () => {
    const g = typeGroups(all, shortcuts, false);
    expect(g.special.map((x) => x.id)).toEqual(['k']);
    expect(defaultType(g, false)?.id).toBe('a');
  });

  it('Sıralı + hazır rota yok → ilk kısayol; hiçbiri yok → null (Okut pasif)', () => {
    expect(defaultType(typeGroups([], shortcuts, false), false)?.id).toBe('k');
    expect(defaultType(typeGroups([], [], false), false)).toBeNull();
  });

  it('seçili tür listede yoksa (kip değişti / rota pasif) varsayılana döner', () => {
    const g = typeGroups(all, shortcuts, false);
    expect(resolveType('b', g, false)?.id).toBe('b');
    expect(resolveType(SCAN_ROUTE_ID, g, false)?.id).toBe('a');
    expect(resolveType('p', g, false)?.id).toBe('a');
  });
});

describe('Fason okutma', () => {
  it('düğme → tür: Fason düğmesi CUSTOMER_GOODS_SERVICE, İE oluştur bugünkü türetme', () => {
    expect(scanWoType('CUSTOMER_GOODS')).toBe('CUSTOMER_GOODS_SERVICE');
    expect(scanWoType('STANDARD')).toBeNull();
  });
});
