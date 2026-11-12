// Tek İE formunun "Kendi üretim" kipi (saf): kip yüklemi, emanet ön süzgeci, quick-start gövdesi, deneme kimliği, sonuç satırı.
// NEGATİF SONDA (ölçüldü): `isOwnGoodsMode` tek türde `kinds[0]` yerine `chosen`a bakınca "tek tür STANDARD" testi KIRMIZI.
import type { ProductionRoute } from '../../../../services/route.service';
import { buildOwnGoodsBody, isOwnGoodsMode, ownGoodsAttemptKey, ownGoodsResultText, ownGoodsRollReject } from './ownGoods';
import { SCAN_ROUTE } from './woFromDoc';
import type { ExtraBody } from './woForm';

const route = { id: 'r1', name: 'Kurşun', steps: [] } as unknown as ProductionRoute;

describe('isOwnGoodsMode', () => {
  it('⭐ tek tür STANDARD → kendi üretim; tek tür CUSTOMER_GOODS → belge kipi', () => {
    expect(isOwnGoodsMode(['STANDARD'], null)).toBe(true);
    expect(isOwnGoodsMode(['CUSTOMER_GOODS'], null)).toBe(false);
  });
  it('⭐ iki türde yalnız kartta STANDARD seçiliyken; kart boş / Fason seçili → belge kipi', () => {
    expect(isOwnGoodsMode(['STANDARD', 'CUSTOMER_GOODS'], 'STANDARD')).toBe(true);
    expect(isOwnGoodsMode(['STANDARD', 'CUSTOMER_GOODS'], 'CUSTOMER_GOODS')).toBe(false);
    expect(isOwnGoodsMode(['STANDARD', 'CUSTOMER_GOODS'], null)).toBe(false);
  });
  it('türler verilmemiş giriş (gelen belge formu) hep bugünkü belge kipi', () => {
    expect(isOwnGoodsMode(undefined, 'STANDARD')).toBe(false);
    expect(isOwnGoodsMode([], 'STANDARD')).toBe(false);
  });
});

describe('ownGoodsRollReject', () => {
  it('⭐ emanet (müşteri malı) top reddedilir, bizim top geçer', () => {
    expect(ownGoodsRollReject({ ownerCustomerId: null })).toBeNull();
    expect(ownGoodsRollReject({})).toBeNull();
    expect(ownGoodsRollReject({ ownerCustomerId: 'c1' })).toMatch(/Müşteri malı/);
    expect(ownGoodsRollReject({ ownerCustomer: { id: 'c1', name: 'Firma A' } })).toMatch(/Firma A/);
  });
});

describe('buildOwnGoodsBody', () => {
  const extra = { targetItemId: 'i1', notes: 'not', type: 'STOCK_PRODUCTION' } as unknown as ExtraBody;
  it('⭐ ownGoods + toplar + şablon rotası; not gitmez', () => {
    const b = buildOwnGoodsBody(extra, route, ['B1', 'B2'], 't1');
    expect(b).toMatchObject({ ownGoods: true, rollBarcodes: ['B1', 'B2'], routeTemplateId: 'r1', targetItemId: 'i1', clientToken: 't1' });
    expect(b).not.toHaveProperty('notes');
    expect(b).not.toHaveProperty('scanRouted');
  });
  it('rotasız seçimde scanRouted, rota yoksa rota alanı yok; topsuz gövde boş liste', () => {
    expect(buildOwnGoodsBody(extra, SCAN_ROUTE, [], 't')).toMatchObject({ scanRouted: true, rollBarcodes: [] });
    expect(buildOwnGoodsBody(extra, SCAN_ROUTE, [], 't')).not.toHaveProperty('routeTemplateId');
    const none = buildOwnGoodsBody(extra, null, [], 't');
    expect(none).not.toHaveProperty('routeTemplateId');
    expect(none).not.toHaveProperty('scanRouted');
  });
  it('deneme kimliği tokendan bağımsız, içerik değişince değişir', () => {
    const k1 = ownGoodsAttemptKey(buildOwnGoodsBody(extra, route, ['B1'], 'a'));
    expect(ownGoodsAttemptKey(buildOwnGoodsBody(extra, route, ['B1'], 'b'))).toBe(k1);
    expect(ownGoodsAttemptKey(buildOwnGoodsBody(extra, route, ['B1', 'B2'], 'a'))).not.toBe(k1);
  });
});

describe('ownGoodsResultText', () => {
  it('topsuzda "Parti Ekle" yönlendirmesi, toplu açılışta adet + parti', () => {
    expect(ownGoodsResultText({ workOrderNumber: 'IE1', attached: 0 })).toMatch(/Parti Ekle/);
    expect(ownGoodsResultText({ workOrderNumber: 'IE1', attached: 3, batchNumber: 'P05' })).toBe('IE1 oluşturuldu · 3 top ilk istasyona gönderildi (Parti P05).');
  });
});
