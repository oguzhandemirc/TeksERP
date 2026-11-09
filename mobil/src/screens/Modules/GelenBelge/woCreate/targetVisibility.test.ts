// Negatif sonda: `targetColorQuestion` renk veren adım kuralını (HIDDEN dalı) bozunca "rota renk vermiyorsa gizli" vakası kırmızı olur.
import type { ProductionRoute } from '../../../../services/route.service';
import { SCAN_ROUTE } from './woFromDoc';
import { buildExtraBody, EMPTY_EXTRAS } from './woForm';
import { fasonItemPrefill, hiddenTargetFields, routeCanApplyColor, sendsTargetColor, targetColorQuestion } from './targetVisibility';

const route = (...stations: Record<string, unknown>[]): ProductionRoute => ({ id: 'r1', name: 'R', steps: stations.map((station, i) => ({ id: `s${i}`, stationId: `st${i}`, sequence: i + 1, station })) } as never);
const KURSUN = { id: 'a', name: 'Kurşun' };
const BOYA = { id: 'b', name: 'Boya', appliesColor: true };
const FASON_BOYA = { id: 'c', name: 'Fason', defaultCategory: { id: 'k', appliesColor: true } };

describe('routeCanApplyColor', () => {
  it('istasyon ya da varsayılan kategori renk veriyorsa true', () => {
    expect(routeCanApplyColor(route(KURSUN))).toBe(false);
    expect(routeCanApplyColor(route(KURSUN, BOYA))).toBe(true);
    expect(routeCanApplyColor(route(FASON_BOYA))).toBe(true);
    expect(routeCanApplyColor(null)).toBe(false);
  });
});

describe('targetColorQuestion', () => {
  it('⭐ siparişe bağlı: renk siparişten, soru yok', () => {
    expect(targetColorQuestion({ orderLinked: true, route: route(BOYA) })).toBe('ORDER');
  });
  it('⭐ siparişsiz + rota renk vermiyor: gizli', () => {
    expect(targetColorQuestion({ orderLinked: false, route: route(KURSUN) })).toBe('HIDDEN');
  });
  it('siparişsiz + rotada renk veren adım var: sorulur', () => {
    expect(targetColorQuestion({ orderLinked: false, route: route(KURSUN, BOYA) })).toBe('ASK');
  });
  it('rotasız ("Sahada belirlenir") ya da rota yok: sorulur', () => {
    expect(targetColorQuestion({ orderLinked: false, route: SCAN_ROUTE })).toBe('ASK');
    expect(targetColorQuestion({ orderLinked: false, route: null })).toBe('ASK');
  });
});

describe('hiddenTargetFields / sendsTargetColor', () => {
  it('Fason: kumaş gizli; Kendi üretim değil: kumaş görünür', () => {
    expect(hiddenTargetFields({ fason: true, orderLinked: false, route: route(BOYA) })).toEqual(['hedefKumas']);
    expect(hiddenTargetFields({ fason: false, orderLinked: false, route: route(BOYA) })).toEqual([]);
  });
  it('renk de gizliyse listede; gizlenen soruda renk gövdeye girmez, siparişten geleni girer', () => {
    expect(hiddenTargetFields({ fason: true, orderLinked: false, route: route(KURSUN) })).toEqual(['hedefKumas', 'hedefRenk']);
    expect(sendsTargetColor({ orderLinked: false, route: route(KURSUN) })).toBe(false);
    expect(sendsTargetColor({ orderLinked: true, route: route(KURSUN) })).toBe(true);
    expect(sendsTargetColor({ orderLinked: false, route: SCAN_ROUTE })).toBe(true);
  });
});

describe('fasonItemPrefill', () => {
  const declared = { itemText: 'X', colorText: null, suggestedItem: { id: 'i1', name: 'Tül' }, suggestedColor: null };
  it('Fason + boş hedef + eşlenen kart: kart en öne', () => {
    expect(fasonItemPrefill({ fason: true, extras: { targetItemId: null }, declared })).toEqual({ targetItemId: 'i1', targetItemLabel: 'Tül' });
  });
  it('dolu hedef, Fason değil ya da öneri yok: dokunulmaz (sunucu varsayılan kartı)', () => {
    expect(fasonItemPrefill({ fason: true, extras: { targetItemId: 'z' }, declared })).toBeNull();
    expect(fasonItemPrefill({ fason: false, extras: { targetItemId: null }, declared })).toBeNull();
    expect(fasonItemPrefill({ fason: true, extras: { targetItemId: null }, declared: undefined })).toBeNull();
  });
});

describe('buildExtraBody — gizlenen renk', () => {
  const e = { ...EMPTY_EXTRAS, targetColorId: 'c1', targetItemId: 'i1' };
  it('⭐ omitColor: önceden seçilmiş renk gitmez, kumaş gider; değilse renk de gider', () => {
    expect(buildExtraBody(e, { hasTambur: false, omitColor: true })).toEqual({ targetItemId: 'i1' });
    expect(buildExtraBody(e, { hasTambur: false })).toMatchObject({ targetItemId: 'i1', targetColorId: 'c1' });
  });
});
