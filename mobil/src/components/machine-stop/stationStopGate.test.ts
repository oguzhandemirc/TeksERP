import { machineStopChipVisible, stationAllowsStopOpen } from './stationStopGate';

describe('stationAllowsStopOpen', () => {
  it('alan yoksa (eski sunucu) açık — bugünkü davranış', () => {
    expect(stationAllowsStopOpen({})).toBe(true);
    expect(stationAllowsStopOpen(null)).toBe(true);
  });
  it('true açık, false kapalı', () => {
    expect(stationAllowsStopOpen({ machineStopEnabled: true })).toBe(true);
    expect(stationAllowsStopOpen({ machineStopEnabled: false })).toBe(false);
  });
});

describe('machineStopChipVisible', () => {
  const base = { enabled: true, unavailable: false, stationAllows: true, stopOpen: false };
  it('istasyon kapalı + açık duruş yok → çizilmez', () => {
    expect(machineStopChipVisible({ ...base, stationAllows: false })).toBe(false);
  });
  it('istasyon kapalı ama açık duruş var → çizilir (kapatılabilsin)', () => {
    expect(machineStopChipVisible({ ...base, stationAllows: false, stopOpen: true })).toBe(true);
  });
  it('izin/ayar/makine yoksa ya da uç erişilemezse hiç çizilmez', () => {
    expect(machineStopChipVisible({ ...base, enabled: false, stopOpen: true })).toBe(false);
    expect(machineStopChipVisible({ ...base, unavailable: true })).toBe(false);
  });
  it('istasyon açık → bugünkü gibi çizilir', () => {
    expect(machineStopChipVisible(base)).toBe(true);
  });
});
