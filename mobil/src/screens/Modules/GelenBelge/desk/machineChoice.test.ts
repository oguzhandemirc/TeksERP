// Bekçi: makine seçenekleri — "Sonra seçilsin" ilk ve kesik, çip etiketi ortak öneksiz, testID kodla, erişilebilir ad tam.
import { machineChoice } from './machineChoice';

const m = (id: string, code: string, name: string) => ({ id, code, name, stationId: 's' });

describe('machineChoice', () => {
  it('ortak önek ayıklanır, kısa etiketlerde kare çip', () => {
    const r = machineChoice([m('a', 'K10', 'KURŞUN MAKİNESİ 10'), m('b', 'K1', 'KURŞUN MAKİNESİ 1')], 'ie-form-makine');
    expect(r.prefix).toBe('KURŞUN MAKİNESİ');
    expect(r.square).toBe(true);
    expect(r.options[0]).toMatchObject({ value: null, dashed: true, testID: 'ie-form-makine-yok' });
    expect(r.options[1]).toMatchObject({ value: 'a', label: '10', a11y: 'KURŞUN MAKİNESİ 10', testID: 'ie-form-makine-K10' });
    expect(r.shortName('b')).toBe('1');
    expect(r.shortName(null)).toBeNull();
  });
  it('ortak önek yoksa tam ad, kare değil; ad boşsa kod', () => {
    const r = machineChoice([m('a', 'K10', 'KURŞUN MAKİNESİ 10'), m('b', 'K3', '')], 'x');
    expect(r.prefix).toBeNull();
    expect(r.square).toBe(false);
    expect(r.options.map((o) => o.label)).toEqual(['Sonra seçilsin', 'KURŞUN MAKİNESİ 10', 'K3']);
  });
});
