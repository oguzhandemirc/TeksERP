// =============================================================================
// BEKÇİ: uzaktan güncelleme — yenileme kapısı
// =============================================================================
// ⚠️ NEDEN: buradaki hata SESSİZDİR ve sahada geri dönüşü yoktur.
//
//  Yenileme, gönderilmemiş kayıt varken yapılırsa (`reloadAsync` JS'i
//     öldürür) uçuştaki KK1 girişi / tambur kesimi yarıda kalır. Sonuç bir
//     hata değil, EKSİK KAYITTIR — ve olay anından saatler sonra fark edilir,
//     o noktada sebebi bulunamaz. Kural kullanıcı tercihinin istisnası değil,
//     veri kaybı önlemesidir. (Sürüm adının sayısal karşılaştırması
//     `clientPolicy.service.test.ts`te.)
// =============================================================================

import { yenilemeAkisi, type YenilemeBagimlilik } from './appUpdate.service';

// Servis modülü native/ağ bağımlılıkları taşır; test yalnız SAF çekirdeği
// ölçer, o yüzden hepsi susturulur.
jest.mock('expo-updates', () => ({
  isEnabled: false,
  updateId: null,
  runtimeVersion: null,
  createdAt: null,
  isEmbeddedLaunch: true,
  reloadAsync: jest.fn(),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../offline/queryClient', () => ({
  queryClient: { getMutationCache: () => ({ getAll: () => [] }) },
}));

/** Sahte zaman + sahte bekleme — test gerçek saniye harcamaz. */
function kur(opts: {
  etkin?: boolean;
  /** Her yoklamada dönecek bekleyen kayıt sayısı (sırayla tüketilir; son değer kalıcı). */
  bekleyenler: number[];
}) {
  let saat = 1_000_000;
  const bekleyenler = [...opts.bekleyenler];
  const yenile = jest.fn(async () => {});
  const uyu = jest.fn(async (ms: number) => {
    saat += ms; // beklemek zamanı İLERLETİR — tavan böylece gerçekten dolar
  });
  const d: YenilemeBagimlilik = {
    etkin: () => opts.etkin ?? true,
    bekleyen: () => (bekleyenler.length > 1 ? bekleyenler.shift()! : bekleyenler[0] ?? 0),
    yenile,
    simdi: () => saat,
    uyu,
  };
  return { d, yenile, uyu };
}

describe('yenilemeAkisi — yenileme kapısı', () => {
  it('kuyruk boşken hemen yeniler', async () => {
    const { d, yenile, uyu } = kur({ bekleyenler: [0] });
    await expect(yenilemeAkisi(d)).resolves.toBe('yenilendi');
    expect(yenile).toHaveBeenCalledTimes(1);
    expect(uyu).not.toHaveBeenCalled(); // beklemeden yenilemeli
  });

  it('gönderilmemiş kayıt VARKEN yenilemez, boşalınca yeniler', async () => {
    // 3 yoklama boyunca kayıt var, sonra boşalıyor.
    const { d, yenile, uyu } = kur({ bekleyenler: [2, 2, 1, 0] });
    await expect(yenilemeAkisi(d)).resolves.toBe('yenilendi');
    expect(uyu).toHaveBeenCalledTimes(3);
    expect(yenile).toHaveBeenCalledTimes(1);
  });

  it('kuyruk boşalmazsa TAVAN dolunca ertelenir — yenileme ÇAĞRILMAZ', async () => {
    const { d, yenile } = kur({ bekleyenler: [1] }); // hiç boşalmıyor
    await expect(yenilemeAkisi(d, 2_000, 500)).resolves.toBe('ertelendi');
    expect(yenile).not.toHaveBeenCalled();
  });

  it('uzaktan güncelleme kapalıysa hiç dokunmaz', async () => {
    const { d, yenile, uyu } = kur({ etkin: false, bekleyenler: [0] });
    await expect(yenilemeAkisi(d)).resolves.toBe('kapali');
    expect(yenile).not.toHaveBeenCalled();
    expect(uyu).not.toHaveBeenCalled();
  });
});
