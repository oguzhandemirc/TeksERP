// Arka plan hatırlatması planı: açık-üstlenilmemiş alarm yoksa YOK; varsa tek hatırlatma,
// susturulmuşsa susturma bitiminde; metin "HH:mm itibarıyla" der (bayatlığı saklamaz).
import { reminderPlanOf } from './reminder';
import { alarmItem, MIN, T0 } from '../../test/loomAlarmFixture';

const fmt = () => '11:00';

describe('reminderPlanOf', () => {
  it('açık alarm yok (hepsi üstlenildi) → plan yok', () => {
    expect(reminderPlanOf([alarmItem({ state: 'ACKED' })], T0, 10, fmt)).toBeNull();
    expect(reminderPlanOf([], T0, 10, fmt)).toBeNull();
  });

  it('tek açık alarm → aralık sonra, alarm sayfasına gider', () => {
    const p = reminderPlanOf([alarmItem()], T0, 10, fmt)!;
    expect(p.fireAt).toBe(T0 + 10 * MIN);
    expect(p.alarmId).toBe(alarmItem().id);
    expect(p.body).toContain('11:00 itibarıyla 1 açık alarm');
  });

  it('susturulmuş alarm → susturma bitiminde; birden çok alarm → liste', () => {
    const snoozed = alarmItem({ id: 'b', snoozedUntil: new Date(T0 + 30 * MIN).toISOString() });
    const p = reminderPlanOf([snoozed, alarmItem({ id: 'c' })], T0, 45, fmt)!;
    expect(p.fireAt).toBe(T0 + 30 * MIN);
    expect(p.alarmId).toBeNull();
    expect(p.title).toContain('+1 alarm daha');
  });

  it('geçersiz aralık → varsayılan 10 dk', () => {
    expect(reminderPlanOf([alarmItem()], T0, 0, fmt)!.fireAt).toBe(T0 + 10 * MIN);
  });
});
