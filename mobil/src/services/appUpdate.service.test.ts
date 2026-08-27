// =============================================================================
// BEKÇİ: uzaktan güncelleme — yenileme kapısı + sürüm karşılaştırması
// =============================================================================
// ⚠️ NEDEN: buradaki iki hata da SESSİZDİR ve sahada geri dönüşü yoktur.
//
//  1) Yenileme, gönderilmemiş kayıt varken yapılırsa (`reloadAsync` JS'i
//     öldürür) uçuştaki KK1 girişi / tambur kesimi yarıda kalır. Sonuç bir
//     hata değil, EKSİK KAYITTIR — ve olay anından saatler sonra fark edilir,
//     o noktada sebebi bulunamaz. Kural kullanıcı tercihinin istisnası değil,
//     veri kaybı önlemesidir.
//
//  2) Sürüm karşılaştırması ada göre yapılırsa ("2.9.10" < "2.9.9" sözlüksel
//     olarak DOĞRUDUR) tablet yeni sürümü hiç görmez ve sonsuza kadar eski
//     kalır — üstelik hiçbir hata basmaz.
// =============================================================================

import { apkYeniMi, yenilemeAkisi, type YenilemeBagimlilik } from './appUpdate.service';

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
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: '/tmp/' }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
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

describe('apkYeniMi — sürüm karşılaştırması', () => {
  it('sunucudaki versionCode büyükse yeni sayar', () => {
    expect(apkYeniMi({ varMi: true, versionCode: 54 }, 53)).toBe(true);
  });

  it('eşit ya da küçükse yeni saymaz (geri sürüm ittirmez)', () => {
    expect(apkYeniMi({ varMi: true, versionCode: 53 }, 53)).toBe(false);
    expect(apkYeniMi({ varMi: true, versionCode: 52 }, 53)).toBe(false);
  });

  it('yayın yoksa yeni saymaz', () => {
    expect(apkYeniMi(null, 53)).toBe(false);
    expect(apkYeniMi({ varMi: false }, 53)).toBe(false);
  });

  it('SAYISAL karşılaştırır — ada göre olsaydı 2.9.10 < 2.9.9 çıkardı', () => {
    // versionName 2.9.10 ↔ vc 60, kurulu 2.9.9 ↔ vc 59.
    expect(apkYeniMi({ varMi: true, versionCode: 60, versionName: '2.9.10' }, 59)).toBe(true);
    // Sözlüksel karşılaştırmanın yanlış cevabı burada kanıtlanır:
    expect('2.9.10' > '2.9.9').toBe(false);
  });
});
