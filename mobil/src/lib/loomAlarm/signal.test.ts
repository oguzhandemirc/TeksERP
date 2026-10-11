// Sinyal politikası (ne zaman çalar, kaç kez) + düğme politikası + biçim — panel aynası.
import { alarmSignalOf, freshSignals, notificationTextOf, stripLeadOf } from './signal';
import { consumeFreshSignals } from './dispatch';
import { alarmButtons } from './policy';
import { durationVsTarget, eventLabel, formatClock, formatMinutes } from './format';
import { alarmItem, MIN, T0 } from '../../test/loomAlarmFixture';

const set = () => {
  const s = new Set<string>();
  return { has: (k: string) => s.has(k), add: (k: string) => void s.add(k) };
};

describe('sinyal', () => {
  it('açık alarm → k1 anahtarı; tekrar aralığı geçince :r1', () => {
    const a = alarmItem();
    expect(alarmSignalOf(a, T0, 30)?.key).toBe(`${a.id}:k1`);
    expect(alarmSignalOf(a, T0, 5)?.key).toBe(`${a.id}:k1:r2`);
  });

  it('üstlenilmiş k1 çalmaz; üstlenilmiş k2 bir kez çalar; kapalı çalmaz', () => {
    expect(alarmSignalOf(alarmItem({ state: 'ACKED' }), T0, 5)).toBeNull();
    expect(alarmSignalOf(alarmItem({ state: 'ACKED', tier: 2 }), T0, 5)?.repeat).toBe(0);
    expect(alarmSignalOf(alarmItem({ state: 'RESOLVED' }), T0, 5)).toBeNull();
  });

  it('susturulmuş alarm tekrar çalmaz', () => {
    const a = alarmItem({ snoozedUntil: new Date(T0 + MIN).toISOString() });
    expect(alarmSignalOf(a, T0, 1)?.repeat).toBe(0);
  });

  it('aynı anahtar bir kez çalar; üst kademe önce', () => {
    const seen = set();
    const k1 = alarmItem({ id: 'a' });
    const k2 = alarmItem({ id: 'b', tier: 2 });
    expect(consumeFreshSignals([k1, k2], T0, 30, seen).map((s) => s.alarm.id)).toEqual(['b', 'a']);
    expect(consumeFreshSignals([k1, k2], T0, 30, seen)).toEqual([]);
    expect(freshSignals([k1], seen, T0 + 60 * MIN, 30).length).toBe(1);
  });

  it('şerit: kapatılan alarm öne çıkmaz', () => {
    const a = alarmItem();
    expect(stripLeadOf([a], new Set())?.id).toBe(a.id);
    expect(stripLeadOf([a], new Set([`${a.id}:k1`]))).toBeNull();
  });

  it('bildirim metni tezgah · süre · hedef taşır', () => {
    const t = notificationTextOf(alarmSignalOf(alarmItem(), T0, 30)!, T0, 2);
    expect(t.title).toBe('Yeni tezgah alarmı: TZ-12 · İp atlama');
    expect(t.body).toBe('Hol A · 20 dk duruyor (hedef 10 dk) · +2 alarm daha');
  });
});

describe('düğme politikası', () => {
  const ACT = { canAct: true, canReleaseOthers: false };
  it('eylem izni yoksa hiçbir düğme', () => {
    expect(Object.values(alarmButtons(alarmItem(), { canAct: false, canReleaseOthers: true }, 'u', T0)).some(Boolean)).toBe(false);
  });
  it('açık → üstlen + sustur + not', () => {
    expect(alarmButtons(alarmItem(), ACT, 'u', T0)).toMatchObject({ ack: true, release: false, snooze: true, note: true });
  });
  it('başkası üstlendi → bırakma yalnız escalation ile', () => {
    const a = alarmItem({ state: 'ACKED', ackedBy: { id: 'x', name: 'Ahmet' } });
    expect(alarmButtons(a, ACT, 'u', T0).releaseOther).toBe(false);
    expect(alarmButtons(a, { canAct: true, canReleaseOthers: true }, 'u', T0).releaseOther).toBe(true);
    expect(alarmButtons(a, ACT, 'x', T0).release).toBe(true);
  });
  it('kapalı alarm → yalnız not', () => {
    expect(alarmButtons(alarmItem({ state: 'RESOLVED' }), ACT, 'u', T0)).toEqual({ ack: false, release: false, releaseOther: false, snooze: false, unsnooze: false, note: true });
  });
});

describe('biçim', () => {
  it('süre ve sayaç', () => {
    expect(formatMinutes(65)).toBe('1 sa 05 dk');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(durationVsTarget(alarmItem(), T0)).toBe('20 dk / hedef 10 dk');
  });
  it('tanınmayan olay türü jenerik', () => {
    expect(eventLabel('YENI_TUR', null)).toBe('Olay');
    expect(eventLabel('RAISED', 2)).toBe('Patrona iletildi (2. kademe)');
  });
});
