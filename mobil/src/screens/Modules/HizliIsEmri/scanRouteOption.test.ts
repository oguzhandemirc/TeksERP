// K29 S15b: Hızlı İE rota seçicide rotasız seçenek — liste/çip sırası, gövde, varsayılan kuralı.
import { SCAN_ROUTE_ID, isScanRouteId, routeBodyOf, scanRouteDefault, withScanRouteChip, withScanRouteOption } from './scanRouteOption';

const opts = [{ value: 'r1', label: 'Kurşun&Tambur' }];
const chips = [1, 2, 3, 4].map((i) => ({ id: `r${i}`, name: `R${i}`, isLast: i === 1, isFav: false }));

describe('Hızlı İE rotasız seçenek', () => {
  it('⭐ Okutmayla: seçicide "Sahada belirlenir (rotasız)" İLK; sıralıda liste aynen', () => {
    expect(withScanRouteOption(opts, true).map((o) => o.label)).toEqual(['Sahada belirlenir (rotasız)', 'Kurşun&Tambur']);
    expect(withScanRouteOption(opts, false)).toEqual(opts);
  });
  it('çiplerde rotasız başta, tavan 4 korunur; sıralıda çipler aynen', () => {
    const c = withScanRouteChip(chips, true);
    expect(c.map((x) => x.id)).toEqual([SCAN_ROUTE_ID, 'r1', 'r2', 'r3']);
    expect(withScanRouteChip(chips, false)).toEqual(chips);
  });
  it('⭐ gövde: rotasız → scanRouted:true ve rota anahtarı YOK; şablon → bugünkü routeTemplateId', () => {
    expect(routeBodyOf(SCAN_ROUTE_ID)).toEqual({ scanRouted: true });
    expect('routeTemplateId' in routeBodyOf(SCAN_ROUTE_ID)).toBe(false);
    expect(routeBodyOf('r1')).toEqual({ routeTemplateId: 'r1' });
    expect(routeBodyOf(null)).toEqual({ routeTemplateId: null });
  });
  it('⭐ varsayılan: Okutmayla + seçim yok → rotasız; kısayol rotası / operatör seçimi ezilmez', () => {
    expect(scanRouteDefault({ scanMode: true, userPicked: false, hasInitialRoute: false, current: 'r1' })).toEqual({ next: SCAN_ROUTE_ID });
    expect(scanRouteDefault({ scanMode: true, userPicked: false, hasInitialRoute: false, current: null })).toEqual({ next: SCAN_ROUTE_ID });
    expect(scanRouteDefault({ scanMode: true, userPicked: true, hasInitialRoute: false, current: 'r1' })).toBeNull();
    expect(scanRouteDefault({ scanMode: true, userPicked: false, hasInitialRoute: true, current: 'r1' })).toBeNull();
    expect(scanRouteDefault({ scanMode: true, userPicked: false, hasInitialRoute: false, current: SCAN_ROUTE_ID })).toBeNull();
  });
  it('sıralı: rotasız seçim düşer (sunucu 400 verirdi), başka seçime dokunulmaz', () => {
    expect(scanRouteDefault({ scanMode: false, userPicked: true, hasInitialRoute: false, current: SCAN_ROUTE_ID })).toEqual({ next: null });
    expect(scanRouteDefault({ scanMode: false, userPicked: false, hasInitialRoute: false, current: 'r1' })).toBeNull();
    expect(isScanRouteId('r1')).toBe(false);
  });
});
