import { useDeviceSettingsStore } from './deviceSettingsStore';
import { storage } from '../utils/storage';

// Cihaz-içi kalıcı tercihler: metraj MANUEL mi OTOMATİK mi girilecek. Saha
// gerekçesi: metre makinesi arızalı bir istasyonda operatör her top girişinde
// anahtarı yeniden açmak zorunda kalıyordu.
jest.mock('../utils/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}));

const mem = storage as jest.Mocked<typeof storage>;

/** Diski taklit et — yazılan değer sonraki init'te geri okunsun. */
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

beforeEach(() => {
  jest.clearAllMocks();
  useDeviceSettingsStore.setState({
    manualBarcodeEntry: false,
    lastRouteTemplateId: null,
    kk1ManualEntry: false,
    tamburCutMode: 'manual',
    isLoaded: false,
  });
});

describe('deviceSettingsStore — metraj giriş tercihi', () => {
  it('kayıt yokken varsayılanlar: KK1 otomatik (manuel kapalı), Tambur manuel', async () => {
    fakeDisk();
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().kk1ManualEntry).toBe(false);
    expect(useDeviceSettingsStore.getState().tamburCutMode).toBe('manual');
  });

  it('KK1 tercihi diske yazılır ve SONRAKİ açılışta geri gelir', async () => {
    const disk = fakeDisk();
    await useDeviceSettingsStore.getState().setKk1ManualEntry(true);
    expect(disk['device_kk1_manual_meter']).toBe('true');

    // Uygulama yeniden açıldı (state sıfır, disk dolu).
    useDeviceSettingsStore.setState({ kk1ManualEntry: false, isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().kk1ManualEntry).toBe(true);
  });

  it('Tambur tercihi diske yazılır ve SONRAKİ açılışta geri gelir', async () => {
    const disk = fakeDisk();
    await useDeviceSettingsStore.getState().setTamburCutMode('auto');
    expect(disk['device_tambur_cut_mode']).toBe('auto');

    useDeviceSettingsStore.setState({ tamburCutMode: 'manual', isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburCutMode).toBe('auto');
  });

  it('state ANINDA döner (disk yazımı beklenmez — anahtar takılmasın)', () => {
    fakeDisk();
    void useDeviceSettingsStore.getState().setKk1ManualEntry(true);
    expect(useDeviceSettingsStore.getState().kk1ManualEntry).toBe(true);
  });

  it('diskteki değer bozuksa güvenli varsayılana düşer (manuel)', async () => {
    fakeDisk({ device_tambur_cut_mode: 'ÇÖP' });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburCutMode).toBe('manual');
  });

  it('eski cihaz ayarları (barkod/rota) bu eklemeden etkilenmez', async () => {
    fakeDisk({ device_manual_barcode_entry: 'true', device_quick_wo_last_route: 'r-1' });
    await useDeviceSettingsStore.getState().init();
    const s = useDeviceSettingsStore.getState();
    expect(s.manualBarcodeEntry).toBe(true);
    expect(s.lastRouteTemplateId).toBe('r-1');
  });
});
