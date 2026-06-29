// btMeterStore: 2-kat / 4-kat metre cihazları + sorgu komutu kalıcılığı.
// storage'ı in-memory mock'la → gerçek persist round-trip doğrulanır.
import { useBtMeterStore, meterDeviceFor } from './btMeterStore';
import { storage } from '../utils/storage';

jest.mock('../utils/storage', () => {
  const mem: Record<string, string> = {};
  return {
    storage: {
      getItem: jest.fn(async (k: string) => mem[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        mem[k] = v;
      }),
      deleteItem: jest.fn(async (k: string) => {
        delete mem[k];
      }),
    },
  };
});

const KEY = 'bt_meter_config';
const D2 = { address: 'AA:11', name: '2-Kat HC06' };
const D4 = { address: 'BB:22', name: '4-Kat HC06' };

describe('btMeterStore', () => {
  beforeEach(async () => {
    await storage.deleteItem(KEY);
    useBtMeterStore.setState({
      device2Kat: null,
      device4Kat: null,
      pollCommand: '',
      simulationEnabled: false,
      isLoaded: false,
    });
  });

  it('init: kayıt yoksa iki cihaz da null, simülasyon KAPALI + isLoaded true', async () => {
    await useBtMeterStore.getState().init();
    const s = useBtMeterStore.getState();
    expect(s.device2Kat).toBeNull();
    expect(s.device4Kat).toBeNull();
    expect(s.pollCommand).toBe('');
    expect(s.simulationEnabled).toBe(false); // varsayılan kapalı
    expect(s.isLoaded).toBe(true);
  });

  it('setSimulationEnabled → persist eder, init geri okur (varsayılan kapalı)', async () => {
    await useBtMeterStore.getState().setSimulationEnabled(true);
    useBtMeterStore.setState({ simulationEnabled: false, isLoaded: false });
    await useBtMeterStore.getState().init();
    expect(useBtMeterStore.getState().simulationEnabled).toBe(true);
  });

  it('setDevice → ayrı slotlara yazar, persist eder, init geri okur', async () => {
    await useBtMeterStore.getState().setDevice('2-KAT', D2);
    await useBtMeterStore.getState().setDevice('4-KAT', D4);
    expect(useBtMeterStore.getState().device2Kat).toEqual(D2);
    expect(useBtMeterStore.getState().device4Kat).toEqual(D4);

    // state sıfırla → init persisted değerleri okumalı
    useBtMeterStore.setState({ device2Kat: null, device4Kat: null, pollCommand: '', isLoaded: false });
    await useBtMeterStore.getState().init();
    expect(useBtMeterStore.getState().device2Kat).toEqual(D2);
    expect(useBtMeterStore.getState().device4Kat).toEqual(D4);
  });

  it('setDevice(null) → yalnız o slotu temizler, diğerini korur', async () => {
    await useBtMeterStore.getState().setDevice('2-KAT', D2);
    await useBtMeterStore.getState().setDevice('4-KAT', D4);
    await useBtMeterStore.getState().setDevice('2-KAT', null);
    expect(useBtMeterStore.getState().device2Kat).toBeNull();
    expect(useBtMeterStore.getState().device4Kat).toEqual(D4);
  });

  it('setPollCommand → persist eder ve init geri okur', async () => {
    await useBtMeterStore.getState().setPollCommand('R');
    useBtMeterStore.setState({ device2Kat: null, device4Kat: null, pollCommand: '', isLoaded: false });
    await useBtMeterStore.getState().init();
    expect(useBtMeterStore.getState().pollCommand).toBe('R');
  });

  it('init: bozuk JSON → seçimsiz başlar (çökmez)', async () => {
    await storage.setItem(KEY, '{bozuk');
    await useBtMeterStore.getState().init();
    const s = useBtMeterStore.getState();
    expect(s.device2Kat).toBeNull();
    expect(s.device4Kat).toBeNull();
    expect(s.isLoaded).toBe(true);
  });

  it('init: address eksik cihaz → null sayılır', async () => {
    await storage.setItem(KEY, JSON.stringify({ device2Kat: { name: 'isimsiz' } }));
    await useBtMeterStore.getState().init();
    expect(useBtMeterStore.getState().device2Kat).toBeNull();
  });

  it('meterDeviceFor: 4-KAT → 4-kat cihazı, diğer her şey → 2-kat cihazı', () => {
    const state = { device2Kat: D2, device4Kat: D4 };
    expect(meterDeviceFor(state, '4-KAT')).toEqual(D4);
    expect(meterDeviceFor(state, '2-KAT')).toEqual(D2);
    expect(meterDeviceFor(state, null)).toEqual(D2);
    expect(meterDeviceFor(state, 'BILINMEYEN')).toEqual(D2);
  });
});
