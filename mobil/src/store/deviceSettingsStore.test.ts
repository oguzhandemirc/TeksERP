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
    tamburManualMode: false,
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

// Tambur "MANUEL EKLE" modu — kart okutmadan bitmiş top girişi. Kart izini
// atlattığı için varsayılanı KAPALI olmalı ve diskteki her belirsiz değer
// KAPALI'ya düşmeli (bir yazım hatası modu sessizce açmamalı).
describe('deviceSettingsStore — Tambur manuel mod anahtarı', () => {
  it('kayıt yokken KAPALI (kart bekleyen normal akış)', async () => {
    fakeDisk();
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburManualMode).toBe(false);
  });

  it('diske yazılır ve SONRAKİ açılışta geri gelir', async () => {
    const disk = fakeDisk();
    await useDeviceSettingsStore.getState().setTamburManualMode(true);
    expect(disk['device_tambur_manual_mode']).toBe('true');

    useDeviceSettingsStore.setState({ tamburManualMode: false, isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburManualMode).toBe(true);
  });

  it('kapatma da kalıcıdır (açık kalıp sessizce geri gelmez)', async () => {
    const disk = fakeDisk({ device_tambur_manual_mode: 'true' });
    await useDeviceSettingsStore.getState().setTamburManualMode(false);
    expect(disk['device_tambur_manual_mode']).toBe('false');

    useDeviceSettingsStore.setState({ tamburManualMode: true, isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburManualMode).toBe(false);
  });

  it('diskteki değer bozuksa KAPALI kalır (mod sessizce açılmaz)', async () => {
    fakeDisk({ device_tambur_manual_mode: 'TRUE' });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().tamburManualMode).toBe(false);
  });

  it('state ANINDA döner (disk yazımı beklenmez)', () => {
    fakeDisk();
    void useDeviceSettingsStore.getState().setTamburManualMode(true);
    expect(useDeviceSettingsStore.getState().tamburManualMode).toBe(true);
  });

  it('kesim modu (tamburCutMode) ile birbirini ETKİLEMEZ — ayrı anahtarlar', async () => {
    fakeDisk({ device_tambur_manual_mode: 'true', device_tambur_cut_mode: 'auto' });
    await useDeviceSettingsStore.getState().init();
    const s = useDeviceSettingsStore.getState();
    expect(s.tamburManualMode).toBe(true);
    expect(s.tamburCutMode).toBe('auto');
  });
});

describe('deviceSettingsStore — geriye dönük uyum', () => {
  it('eski cihaz ayarları (barkod/rota) bu eklemeden etkilenmez', async () => {
    fakeDisk({ device_manual_barcode_entry: 'true', device_quick_wo_last_route: 'r-1' });
    await useDeviceSettingsStore.getState().init();
    const s = useDeviceSettingsStore.getState();
    expect(s.manualBarcodeEntry).toBe(true);
    expect(s.lastRouteTemplateId).toBe('r-1');
  });
});

// Kamera yönü — "en son ne kullandıysam" tercihi. Saha gerekçesi: sabit
// montajlı / ekranı operatöre dönük tablette ön kamera kullanılıyor ve tarayıcı
// her açılışta arkaya sıfırlandığı için yön elle çevriliyordu.
describe('deviceSettingsStore — kamera yönü tercihi', () => {
  it('kayıt yokken ARKA (barkod okumanın endüstri varsayılanı)', async () => {
    fakeDisk();
    // Ters değerden başla: aksi halde kontrol store'un doğuştan gelen
    // varsayılanını ölçer, init()'in kayıt yokluğunu ÇÖZDÜĞÜNÜ değil.
    useDeviceSettingsStore.setState({ cameraFacing: 'front', isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe('back');
  });

  it('diske yazılır ve SONRAKİ açılışta geri gelir', async () => {
    const disk = fakeDisk();
    await useDeviceSettingsStore.getState().setCameraFacing('front');
    expect(disk['device_camera_facing']).toBe('front');

    useDeviceSettingsStore.setState({ cameraFacing: 'back', isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe('front');
  });

  it('arkaya dönüş de kalıcıdır (ön kamerada takılı kalmaz)', async () => {
    const disk = fakeDisk({ device_camera_facing: 'front' });
    await useDeviceSettingsStore.getState().setCameraFacing('back');
    expect(disk['device_camera_facing']).toBe('back');

    useDeviceSettingsStore.setState({ cameraFacing: 'front', isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe('back');
  });

  it('diskteki değer bozuksa ARKA (yalnız birebir "front" ön kamerayı açar)', async () => {
    fakeDisk({ device_camera_facing: 'FRONT' });
    useDeviceSettingsStore.setState({ cameraFacing: 'front', isLoaded: false });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe('back');
  });

  it('state ANINDA döner (kamera flip tuşu disk yazımını beklemez)', () => {
    fakeDisk();
    void useDeviceSettingsStore.getState().setCameraFacing('front');
    expect(useDeviceSettingsStore.getState().cameraFacing).toBe('front');
  });
});
