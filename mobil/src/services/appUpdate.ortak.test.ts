// =============================================================================
// BEKÇİ: tek ortak paket O8 + K-14 — OTA denetimi ve güncelleme grubu belirteç yanıtından (`grup`)
// =============================================================================
// Ortak paketin gömülü adresi grup-nötr takma addır (`https://indir…/ota/<rv>/manifest`); Worker belirtecin
// grubuna yönlendirir. Grup YALNIZ backend'in indirme belirteci yanıtından gelir (kurulumun kirası); APK
// künyesi yoktur (native güncelleme Google Play'den, K-14). Grup/belirteç yoksa OTA denetimi YAPILMAZ.
//
// NEGATİF SONDA (ölçüldü): otaKontrolEtVeIndir'deki grup kapısı kalkınca §3a KIRMIZI; fetchUpdateGroup
// belirteç yanıtı yerine sabit grup döndürünce §2b/§2c KIRMIZI.
// =============================================================================
import * as Updates from 'expo-updates';
import { fetchUpdateGroup, otaKimlik, otaKontrolEtVeIndir, ortakPaketKoku } from './appUpdate.service';
import { fetchDownloadGrant, refreshOtaDownloadToken } from './downloadToken.service';

const KOK = 'https://indir.etkiliyazilim.com/';
const ORTAK_OTA = `${KOK}ota/55.0/manifest`;

jest.mock('expo-updates', () => ({
  isEnabled: true, updateId: null, runtimeVersion: '55.0', createdAt: null, isEmbeddedLaunch: true,
  reloadAsync: jest.fn(), checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { android: { versionCode: 50 }, updates: { url: 'https://indir.etkiliyazilim.com/ota/55.0/manifest' } } },
}));
jest.mock('./downloadToken.service', () => ({
  fetchDownloadGrant: jest.fn(async () => ({ belirtec: 'belirtec', grup: 'test' })),
  refreshOtaDownloadToken: jest.fn(async () => 'belirtec'),
}));
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../offline/queryClient', () => ({ queryClient: { getMutationCache: () => ({ getAll: () => [] }) } }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('§1 ortak paket tanıma — gömülü adres grup-nötr takma ad', () => {
  it('§1a ortak adres → kök; eski kanal ve http adresi ortak sayılmaz', () => {
    expect(ortakPaketKoku(ORTAK_OTA)).toBe(KOK);
    expect(ortakPaketKoku('https://indir.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest')).toBeNull();
    expect(ortakPaketKoku('http://indir.etkiliyazilim.com/ota/55.0/manifest')).toBeNull();
    expect(ortakPaketKoku(null)).toBeNull();
  });
  it('§1b otaKimlik ortak paketi tanır, APK künye kökü taşımaz', () => {
    const k = otaKimlik();
    expect(k.ortakPaket).toBe(true);
    expect(k).not.toHaveProperty('feedTabani');
  });
});

describe('§2 fetchUpdateGroup — kaynak belirteç yanıtı', () => {
  it('§2a yanıttaki grup aynen döner', async () => {
    (fetchDownloadGrant as jest.Mock).mockResolvedValue({ belirtec: 'belirtec', grup: 'oncu' });
    expect(await fetchUpdateGroup()).toEqual({ grup: 'oncu', bilinmiyor: false });
    expect(fetchDownloadGrant).toHaveBeenCalledTimes(1);
  });
  it('§2b yanıtta grup yok (eski backend) → bilinmiyor', async () => {
    (fetchDownloadGrant as jest.Mock).mockResolvedValue({ belirtec: 'belirtec', grup: null });
    expect(await fetchUpdateGroup()).toEqual({ grup: null, bilinmiyor: true });
  });
  it('§2c belirteç hiç alınamadı → bilinmiyor', async () => {
    (fetchDownloadGrant as jest.Mock).mockResolvedValue(null);
    expect(await fetchUpdateGroup()).toEqual({ grup: null, bilinmiyor: true });
  });
});

describe('§3 otaKontrolEtVeIndir — ortak pakette belirteçsiz denetim yok', () => {
  it('§3a belirteç yok → "grupBilinmiyor", manifest istenmez', async () => {
    (refreshOtaDownloadToken as jest.Mock).mockResolvedValue(null);
    expect(await otaKontrolEtVeIndir()).toEqual({ durum: 'grupBilinmiyor' });
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });
  it('§3b belirteç var → takma ada sorulur', async () => {
    (refreshOtaDownloadToken as jest.Mock).mockResolvedValue('belirtec');
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({ isAvailable: false });
    expect(await otaKontrolEtVeIndir()).toEqual({ durum: 'guncel' });
    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });
});
