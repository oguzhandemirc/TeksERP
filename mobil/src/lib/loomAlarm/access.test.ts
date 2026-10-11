// Kim neyi görür: bayrak zinciri (üretim ∧ tezgah ∧ alarm) kapalıyken hiçbir yüzey açılmaz;
// `mobile:tezgah-uyari` görme+eylem, `mobile:dokuma` yalnız tezgah şeridini okur.
import { loomAlarmAccessOf } from './access';

const ON = { productionEnabled: true, tezgahEnabled: true, tezgahAlarmEnabled: true, tezgahAlarmRenotifyMinutes: 5 };
const has = (...codes: string[]) => (c: string) => codes.includes(c);

describe('loomAlarmAccessOf', () => {
  it('izinsiz kullanıcı → hiçbir şey', () => {
    const a = loomAlarmAccessOf(has(), ON);
    expect([a.canView, a.canAct, a.canSeeLoomStrip]).toEqual([false, false, false]);
  });

  it('mobile:tezgah-uyari → görür + üstlenir; başkasını bırakamaz', () => {
    const a = loomAlarmAccessOf(has('mobile:tezgah-uyari'), ON);
    expect([a.canView, a.canAct, a.canReleaseOthers, a.canSeeLoomStrip]).toEqual([true, true, false, true]);
    expect(a.renotifyMinutes).toBe(5);
  });

  it('mobile:dokuma → yalnız şerit (üstlenme yok)', () => {
    const a = loomAlarmAccessOf(has('mobile:dokuma'), ON);
    expect([a.canView, a.canAct, a.canSeeLoomStrip]).toEqual([false, false, true]);
  });

  it.each([
    ['alarm bayrağı kapalı', { ...ON, tezgahAlarmEnabled: false }],
    ['tezgah modülü kapalı', { ...ON, tezgahEnabled: false }],
    ['üretim modülü kapalı', { ...ON, productionEnabled: false }],
    ['bayrak okunamadı', null],
  ])('%s → kapalı', (_l, flags) => {
    const a = loomAlarmAccessOf(has('mobile:tezgah-uyari', 'loom:alarm-escalation', 'mobile:dokuma'), flags);
    expect([a.flagOn, a.canView, a.canAct, a.canReleaseOthers, a.canSeeLoomStrip]).toEqual([false, false, false, false, false]);
  });

  it('aralık yoksa varsayılan 10 dk', () => {
    expect(loomAlarmAccessOf(has(), { ...ON, tezgahAlarmRenotifyMinutes: undefined }).renotifyMinutes).toBe(10);
  });
});
