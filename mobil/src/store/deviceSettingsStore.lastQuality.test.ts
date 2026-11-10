import { useDeviceSettingsStore } from './deviceSettingsStore';
import { storage } from '../utils/storage';

// Tambur'da son elle basılan kalite cihazda kalıcıdır (saha 2026-11-10).
jest.mock('../utils/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}));

const mem = storage as jest.Mocked<typeof storage>;

function fakeDisk(initial: Record<string, string> = {}) {
  const disk = { ...initial };
  mem.getItem.mockImplementation(async (k: string) => disk[k] ?? null);
  mem.setItem.mockImplementation(async (k: string, v: string) => {
    disk[k] = v;
  });
  mem.deleteItem.mockImplementation(async (k: string) => {
    delete disk[k];
  });
  return disk;
}

beforeEach(() => jest.clearAllMocks());

describe('deviceSettingsStore — Tambur son basılan kalite (2026-11-10)', () => {
  it('kayıt yokken null; basılan kod diske yazılır ve yeniden açılışta geri gelir', async () => {
    const disk = fakeDisk();
    useDeviceSettingsStore.setState({ tamburLastQualityCode: null });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburLastQualityCode).toBeNull();
    await useDeviceSettingsStore.getState().setTamburLastQualityCode('A1');
    expect(disk['tambur_last_quality_code']).toBe('A1');
    useDeviceSettingsStore.setState({ tamburLastQualityCode: null, isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburLastQualityCode).toBe('A1');
  });

  it('seçim kaldırılınca kayıt silinir (sonraki açılışta seçimsiz)', async () => {
    const disk = fakeDisk({ tambur_last_quality_code: 'A1' });
    await useDeviceSettingsStore.getState().setTamburLastQualityCode(null);
    expect(disk['tambur_last_quality_code']).toBeUndefined();
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburLastQualityCode).toBeNull();
  });
});
