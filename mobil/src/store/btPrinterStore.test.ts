// btPrinterStore: seçili Bluetooth yazıcının kalıcılık + okuma davranışı.
// storage'ı in-memory mock'la → gerçek persist round-trip doğrulanır.
import { useBtPrinterStore } from './btPrinterStore';
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

const KEY = 'bt_label_printer';

describe('btPrinterStore', () => {
  beforeEach(async () => {
    await storage.deleteItem(KEY);
    useBtPrinterStore.setState({ printer: null, isLoaded: false });
  });

  it('init: kayıt yoksa printer null + isLoaded true', async () => {
    await useBtPrinterStore.getState().init();
    expect(useBtPrinterStore.getState().printer).toBeNull();
    expect(useBtPrinterStore.getState().isLoaded).toBe(true);
  });

  it('setPrinter → persist eder, init geri okur', async () => {
    await useBtPrinterStore.getState().setPrinter({ address: 'AA:BB:CC', name: 'Argox 214' });
    expect(useBtPrinterStore.getState().printer).toEqual({ address: 'AA:BB:CC', name: 'Argox 214' });

    // state sıfırla → init persisted değeri okumalı
    useBtPrinterStore.setState({ printer: null, isLoaded: false });
    await useBtPrinterStore.getState().init();
    expect(useBtPrinterStore.getState().printer).toEqual({ address: 'AA:BB:CC', name: 'Argox 214' });
  });

  it('setPrinter(null) → seçimi temizler ve siler', async () => {
    await useBtPrinterStore.getState().setPrinter({ address: 'AA:BB:CC', name: 'Argox' });
    await useBtPrinterStore.getState().setPrinter(null);
    expect(useBtPrinterStore.getState().printer).toBeNull();
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('init: bozuk JSON → null (çökmez)', async () => {
    await storage.setItem(KEY, '{bozuk');
    await useBtPrinterStore.getState().init();
    expect(useBtPrinterStore.getState().printer).toBeNull();
    expect(useBtPrinterStore.getState().isLoaded).toBe(true);
  });

  it('init: name eksik kayıt → address ile doldurur', async () => {
    await storage.setItem(KEY, JSON.stringify({ address: 'DD:EE:FF' }));
    await useBtPrinterStore.getState().init();
    expect(useBtPrinterStore.getState().printer).toEqual({ address: 'DD:EE:FF', name: 'DD:EE:FF' });
  });
});
