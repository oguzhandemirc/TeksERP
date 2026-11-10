// Kes öncesi otomatik okumalar: kg kipi otomatikte tartı yok / okunamadı → kesim ÇAĞRILMAZ (fail-closed).
import { collectCutReadings, kgAutoActive, readKgForCut } from './cutReadings';
import type { DevicePeripheral } from '../../../services/peripheral.service';

jest.mock('../../../hooks/usePeripheralIO', () => ({ buildIoFromPeripheral: jest.fn(), readMeter: jest.fn() }));
jest.mock('../../../services/hal/btClassic.transport', () => ({ isBonded: jest.fn(), pairByMac: jest.fn() }));

describe('readKgForCut', () => {
  it('tartı atanmamış → Türkçe hata toast + null', async () => {
    const toast = jest.fn();
    expect(await readKgForCut(null, toast)).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', text1: 'Kantar tanımlı değil' }));
  });
  it('simulate cihaz → kaynak SIMULATED + bilgi toast', async () => {
    const toast = jest.fn();
    const k = await readKgForCut({ simulate: true } as DevicePeripheral, toast, { random: () => 0.5 });
    expect(k).toEqual({ kg: 55, source: 'SIMULATED' });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });
});

describe('collectCutReadings', () => {
  const cutAfter = async (i: Parameters<typeof collectCutReadings>[0]) => {
    const cut = jest.fn();
    const r = await collectCutReadings(i);
    if (r) cut(r);
    return cut;
  };
  it('kg otomatik + tartı okunamadı → kesim çağrılmaz, damga basılmaz', async () => {
    const stampKg = jest.fn();
    const cut = await cutAfter({ meterAuto: false, kgAuto: true, readMeter: jest.fn(), readKg: async () => null, stampKg });
    expect(cut).not.toHaveBeenCalled();
    expect(stampKg).not.toHaveBeenCalled();
  });
  it('metre otomatik okunamadı → tartıya hiç gidilmez, kesim yok', async () => {
    const readKg = jest.fn();
    const cut = await cutAfter({ meterAuto: true, kgAuto: true, readMeter: async () => null, readKg, stampKg: jest.fn() });
    expect(readKg).not.toHaveBeenCalled();
    expect(cut).not.toHaveBeenCalled();
  });
  it('ikisi de okundu → önce damga, sonra TEK kesim (metre ölçümüyle)', async () => {
    const stampKg = jest.fn();
    const r = await collectCutReadings({ meterAuto: true, kgAuto: true, readMeter: async () => ({ value: 42 }), readKg: async () => ({ kg: 12.5, source: 'SCALE' as const }), stampKg });
    expect(stampKg).toHaveBeenCalledWith({ kg: 12.5, source: 'SCALE' });
    expect(r).toEqual({ capture: { value: 42 } });
  });
  it('kg otomatik yalnız kg alanı varken etkin', () => {
    expect(kgAutoActive('auto', true)).toBe(true);
    expect(kgAutoActive('auto', false)).toBe(false);
    expect(kgAutoActive('manual', true)).toBe(false);
  });
});
