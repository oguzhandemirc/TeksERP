// Hedef özellik seçenekleri: rotadaki istasyonun AUTO verdiği BAYRAK düşer; OPTIONAL / REQUIRED kalır; SEÇİM sayılmaz.
import { autoAppliedPropertyIds, targetPropOptions } from './targetProps';
import { fieldApplicable } from './woFieldCatalog';

const t = (propertyId: string, mode: 'AUTO' | 'OPTIONAL' | 'REQUIRED', valueType: 'FLAG' | 'CHOICE' = 'FLAG') =>
  ({ propertyId, mode, valueType }) as never;

describe('targetProps', () => {
  it('autoAppliedPropertyIds: yalnız AUTO bayraklar (istasyonlar birleşir, tekrar yok)', () => {
    const per = [
      { stationId: 'k', targets: [t('kursun', 'AUTO'), t('gramaj', 'REQUIRED', 'CHOICE'), t('opt', 'OPTIONAL')] },
      { stationId: 't', targets: [t('tambur', 'AUTO'), t('kursun', 'AUTO'), t('req', 'REQUIRED'), t('kat', 'AUTO', 'CHOICE')] },
    ];
    expect(autoAppliedPropertyIds(per).sort()).toEqual(['kursun', 'tambur']);
  });

  it('targetPropOptions: AUTO düşer, OPTIONAL/REQUIRED bayrak kalır', () => {
    const catalog = [{ id: 'kursun' }, { id: 'opt' }, { id: 'req' }];
    expect(targetPropOptions(catalog, ['kursun']).map((o) => o.id)).toEqual(['opt', 'req']);
    expect(targetPropOptions(catalog, ['kursun', 'opt', 'req'])).toEqual([]);
  });

  it('fieldApplicable(hedefOzellik): seçilecek özellik kalmadıysa çizilmez', () => {
    const c = { showQuantity: true, hasTambur: true, hasKursun: true, hasRouteSteps: true };
    expect(fieldApplicable('hedefOzellik', c)).toBe(true);
    expect(fieldApplicable('hedefOzellik', { ...c, noTargetProps: true })).toBe(false);
  });
});
