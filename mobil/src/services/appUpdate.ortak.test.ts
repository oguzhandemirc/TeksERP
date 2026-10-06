// =============================================================================
// BEKÇİ: tek ortak paket O8 — tablet APK künyesi ve OTA denetimi GRUPTAN (belirteç yanıtı `grup`)
// =============================================================================
// Ortak paketin gömülü adresi grup-nötr takma addır (`https://indir…/ota/<rv>/manifest`); kökten türeyen
// `…/apk/surum.json` Worker'da yoktur. Künye `<kök><grup>/mobil/apk/surum.json`dan okunur, künye `kanal`ı
// gruba eşit olmalı; grup yoksa denetim YAPILMAZ ("grup bilinmiyor"). Eski kanal adresi grubu yok sayar.
//
// NEGATİF SONDA (ölçüldü): apkFeedTabani ortak dalında grup yerine kökü döndürünce §1 + §2 KIRMIZI;
// otaKontrolEtVeIndir'deki grup kapısı kalkınca §4 KIRMIZI; eski kanal dalında grup okununca §1c KIRMIZI.
// =============================================================================
import crypto from 'node:crypto';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { apkDurumu, apkFeedTabani, apkIndirVeKur, otaKimlik, otaKontrolEtVeIndir, ortakPaketKoku } from './appUpdate.service';
import { fetchDownloadGrant, refreshOtaDownloadToken } from './downloadToken.service';

const KOK = 'https://indir.etkiliyazilim.com/';
const ORTAK_OTA = `${KOK}ota/55.0/manifest`;

jest.mock('../lib/apk-imza-capasi.json', () => {
  const c = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  const k = c.generateKeyPairSync('ed25519');
  (globalThis as Record<string, unknown>).mockApkAnahtar = k.privateKey;
  return { anahtarlar: [{ kid: 'panel-2099', x: k.publicKey.export({ format: 'jwk' }).x }] };
});
jest.mock('expo-updates', () => ({
  isEnabled: true, updateId: null, runtimeVersion: '55.0', createdAt: null, isEmbeddedLaunch: true,
  reloadAsync: jest.fn(), checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { android: { versionCode: 50 }, updates: { url: 'https://indir.etkiliyazilim.com/ota/55.0/manifest' } } },
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: jest.fn(async () => {}),
  createDownloadResumable: jest.fn(),
  getContentUriAsync: jest.fn(async () => 'content://apk'),
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => {
    const veri = (globalThis as Record<string, unknown>).mockApkBaytlari as Uint8Array;
    let o = 0;
    return {
      open: () => ({
        readBytes: (n: number) => {
          const p = veri.subarray(o, o + n);
          o += p.length;
          return p;
        },
        close: jest.fn(),
      }),
    };
  }),
}));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn(async () => ({})) }));
jest.mock('./downloadToken.service', () => ({
  DOWNLOAD_TOKEN_HEADER: 'X-TKL-Indirme',
  downloadTokenHeaders: jest.fn(async () => {
    throw new Error('ortak pakette tek belirteç isteği (fetchDownloadGrant) beklenir');
  }),
  fetchDownloadGrant: jest.fn(async () => ({ belirtec: 'belirtec', grup: 'test' })),
  refreshOtaDownloadToken: jest.fn(async () => 'belirtec'),
}));
jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../offline/queryClient', () => ({ queryClient: { getMutationCache: () => ({ getAll: () => [] }) } }));

const APK = crypto.randomBytes(200_003);
const APK_SHA = crypto.createHash('sha256').update(APK).digest('hex');
const AD = 'TeksERP-1.0.16-vc57.apk';

function imzali(ek: Record<string, unknown> = {}): string {
  const anahtar = (globalThis as Record<string, unknown>).mockApkAnahtar as crypto.KeyObject;
  const bas = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'tekserp-apk', kid: 'panel-2099' })).toString('base64url');
  const yuk = Buffer.from(JSON.stringify({
    v: 1, urun: 'tablet', platform: 'android-arm64', kanal: 'test', versionCode: 57, versionName: '1.0.16',
    commit: 'abcdef1', yayinZamani: '2026-10-01T10:00:00.000Z', paket: { ad: AD, boyut: APK.length, sha256: APK_SHA },
    capa: ['panel-2099'], ...ek,
  })).toString('base64url');
  return `${bas}.${yuk}.${crypto.sign(null, Buffer.from(`${bas}.${yuk}`), anahtar).toString('base64url')}`;
}

function surumJson(bildirim: string | null): Record<string, unknown> {
  const s: Record<string, unknown> = {
    versionCode: 57, versionName: '1.0.16', dosya: AD, sha256: APK_SHA, boyut: APK.length, zorunlu: false,
    notlar: '', yayinTarihi: '2026-10-01T10:00:00.000Z', indirmeUrl: 'https://saldirgan.example/kotu.apk',
  };
  if (bildirim) s.tekserp = { v: 1, bildirim };
  return s;
}

const fetchMock = jest.fn();
beforeAll(() => {
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as Record<string, unknown>).mockApkBaytlari = APK;
  (FileSystem.createDownloadResumable as jest.Mock).mockImplementation(() => ({
    downloadAsync: async () => ({ uri: 'file:///cache/tekserp-guncelleme.apk' }),
  }));
});

const sunucuVerir = (govde: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => govde });

const grupVerir = (grup: string | null) =>
  (fetchDownloadGrant as jest.Mock).mockResolvedValue({ belirtec: 'belirtec', grup });

describe('§1 apkFeedTabani — ortak pakette kök + grup, eski kanalda gömülü kök', () => {
  it('§1a ortak adres + grup → <kök><grup>/mobil/', () => {
    expect(ortakPaketKoku(ORTAK_OTA)).toBe(KOK);
    expect(apkFeedTabani(ORTAK_OTA, 'test')).toBe(`${KOK}test/mobil/`);
    expect(apkFeedTabani(ORTAK_OTA, 'genel')).toBe(`${KOK}genel/mobil/`);
  });
  it('§1b ortak adres, grup yok/biçimsiz → null (kök DEĞİL)', () => {
    expect(apkFeedTabani(ORTAK_OTA, null)).toBeNull();
    expect(apkFeedTabani(ORTAK_OTA, '../x')).toBeNull();
    expect(apkFeedTabani(ORTAK_OTA, 'Test')).toBeNull();
  });
  it('§1c eski kanal adresi → gömülü kök, grup YOK SAYILIR (adnansahin bayt-eşit yol)', () => {
    const eski = 'https://indir.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest';
    expect(ortakPaketKoku(eski)).toBeNull();
    expect(apkFeedTabani(eski, 'test')).toBe('https://indir.etkiliyazilim.com/adnansahin/mobil/');
    expect(apkFeedTabani(eski, null)).toBe('https://indir.etkiliyazilim.com/adnansahin/mobil/');
    expect(apkFeedTabani('https://guncelleme.etkiliyazilim.com/mobil/ota/54.2/manifest', 'test')).toBe('https://guncelleme.etkiliyazilim.com/mobil/');
    expect(ortakPaketKoku('http://indir.etkiliyazilim.com/ota/55.0/manifest')).toBeNull();
  });
  it('§1d otaKimlik ortak paketi tanır', () => {
    expect(otaKimlik().ortakPaket).toBe(true);
  });
});

describe('§2 apkDurumu — künye gruptan', () => {
  it('§2a grup "test" → test/mobil/apk/surum.json, künye kanalı = grup → yeni sürüm VAR', async () => {
    grupVerir('test');
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    expect(fetchMock.mock.calls[0][0]).toBe(`${KOK}test/mobil/apk/surum.json`);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-TKL-Indirme': 'belirtec' });
    expect(d).toMatchObject({ yeniVarMi: true, grup: 'test', grupBilinmiyor: false, rejection: null });
    expect(fetchDownloadGrant).toHaveBeenCalledTimes(1);
  });
  it('§2b grup yok → hiçbir istek atılmaz, "grup bilinmiyor"', async () => {
    grupVerir(null);
    const d = await apkDurumu();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d).toMatchObject({ yeniVarMi: false, kunye: null, grup: null, grupBilinmiyor: true });
  });
  it('§2c belirteç hiç alınamadı → "grup bilinmiyor"', async () => {
    (fetchDownloadGrant as jest.Mock).mockResolvedValue(null);
    const d = await apkDurumu();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d.grupBilinmiyor).toBe(true);
  });
  it('§2d başka grubun imzalı künyesi → red', async () => {
    grupVerir('test');
    sunucuVerir(surumJson(imzali({ kanal: 'genel' })));
    const d = await apkDurumu();
    expect(d.yeniVarMi).toBe(false);
    expect(d.rejection?.code).toBe('KUNYE_KANAL');
  });
});

describe('§3 apkIndirVeKur — indirme <kök><grup>/mobil/apk/<dosya>', () => {
  it('§3a özet tutar → gruplu adresten iner, kurulum ekranı açılır', async () => {
    grupVerir('test');
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    const s = await apkIndirVeKur(d.verified!);
    expect(s).toEqual({ durum: 'basladi' });
    const [url, , secenek] = (FileSystem.createDownloadResumable as jest.Mock).mock.calls[0];
    expect(url).toBe(`${KOK}test/mobil/apk/${AD}`);
    expect(secenek).toEqual({ headers: { 'X-TKL-Indirme': 'belirtec' } });
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
  });
  it('§3b grup arada değişti → künye bu grubun değil, indirme başlamaz', async () => {
    grupVerir('test');
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    grupVerir('genel');
    const s = await apkIndirVeKur(d.verified!);
    expect(s.durum).toBe('hata');
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });
  it('§3c grup yok → indirme başlamaz', async () => {
    grupVerir('test');
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    grupVerir(null);
    expect((await apkIndirVeKur(d.verified!)).durum).toBe('hata');
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });
});

describe('§4 otaKontrolEtVeIndir — ortak pakette belirteçsiz denetim yok', () => {
  it('§4a belirteç yok → "grupBilinmiyor", manifest istenmez', async () => {
    (refreshOtaDownloadToken as jest.Mock).mockResolvedValue(null);
    expect(await otaKontrolEtVeIndir()).toEqual({ durum: 'grupBilinmiyor' });
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });
  it('§4b belirteç var → takma ada sorulur', async () => {
    (refreshOtaDownloadToken as jest.Mock).mockResolvedValue('belirtec');
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({ isAvailable: false });
    expect(await otaKontrolEtVeIndir()).toEqual({ durum: 'guncel' });
    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });
});
