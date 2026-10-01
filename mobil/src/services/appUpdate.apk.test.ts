// =============================================================================
// BEKÇİ: tablet APK güncelleme akışı (G6) — kurulum ekranı YALNIZ imzalı künye + eşleşen dosyayla açılır
// =============================================================================
// ⚠️ NEDEN: eskiden `surum.json`daki `indirmeUrl` koşulsuz izleniyor, indirilen dosya ölçülmeden Android
// kurulum ekranına veriliyordu. Bu test akışı sabitler: imzasız/yabancı künye "yeni sürüm" sayılmaz; indirme
// adresi gömülü kanal kökünden türer; özet tutmayan dosya silinir ve kurulum ekranı AÇILMAZ.
// =============================================================================
import crypto from 'node:crypto';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { apkDurumu, apkIndirVeKur } from './appUpdate.service';

const FEED = 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/';

jest.mock('../lib/apk-imza-capasi.json', () => {
  const c = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  const k = c.generateKeyPairSync('ed25519');
  (globalThis as Record<string, unknown>).mockApkAnahtar = k.privateKey;
  return { anahtarlar: [{ kid: 'panel-2099', x: k.publicKey.export({ format: 'jwk' }).x }] };
});
jest.mock('expo-updates', () => ({
  isEnabled: true, updateId: null, runtimeVersion: '54.2', createdAt: null, isEmbeddedLaunch: true,
  reloadAsync: jest.fn(), checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { android: { versionCode: 50 }, updates: { url: 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest' } } },
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
  downloadTokenHeaders: jest.fn(async () => ({ 'X-TKL-Indirme': 'belirtec' })),
  refreshOtaDownloadToken: jest.fn(async () => {}),
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
    v: 1, urun: 'tablet', platform: 'android-arm64', kanal: 'adnansahin', versionCode: 57, versionName: '1.0.16',
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
let uyari: jest.SpyInstance;
beforeAll(() => {
  (globalThis as Record<string, unknown>).fetch = fetchMock;
  jest.replaceProperty(Platform, 'OS', 'android');
  uyari = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as Record<string, unknown>).mockApkBaytlari = APK;
  (FileSystem.createDownloadResumable as jest.Mock).mockImplementation(() => ({
    downloadAsync: async () => ({ uri: 'file:///cache/tekserp-guncelleme.apk' }),
  }));
});

const sunucuVerir = (govde: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => govde });

describe('apkDurumu — yeni sürüm yalnız imzalı künyeyle', () => {
  it('imzalı + bu kanalın künyesi → yeni sürüm VAR, doğrulanmış künye döner', async () => {
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    expect(fetchMock.mock.calls[0][0]).toBe(`${FEED}apk/surum.json`);
    expect(d.yeniVarMi).toBe(true);
    expect(d.verified?.paket.sha256).toBe(APK_SHA);
    expect(d.rejection).toBeNull();
  });

  it('imzasız künye (bugünkü yayın biçimi) → yeni sürüm YOK, TR red mesajı', async () => {
    sunucuVerir(surumJson(null));
    const d = await apkDurumu();
    expect(d.yeniVarMi).toBe(false);
    expect(d.verified).toBeNull();
    expect(d.rejection?.code).toBe('KUNYE_YOK');
    expect(d.rejection?.message).toMatch(/imzasız.*kurulmadı/);
    expect(uyari).toHaveBeenCalledWith(expect.stringContaining('REDDEDİLDİ kod=KUNYE_YOK'));
  });

  it('başka kanalın imzalı künyesi → red', async () => {
    sunucuVerir(surumJson(imzali({ kanal: 'testfabrika' })));
    const d = await apkDurumu();
    expect(d.yeniVarMi).toBe(false);
    expect(d.rejection?.code).toBe('KUNYE_KANAL');
  });

  it('kurulu sürümden yeni değilse doğrulama yapılmaz, red de yok (sessiz "güncel")', async () => {
    sunucuVerir({ ...surumJson(null), versionCode: 50 });
    const d = await apkDurumu();
    expect(d).toMatchObject({ yeniVarMi: false, rejection: null });
  });
});

describe('apkIndirVeKur — kurulum ekranı yalnız özeti tutan dosyayla', () => {
  async function dogrulanmis() {
    sunucuVerir(surumJson(imzali()));
    const d = await apkDurumu();
    if (!d.verified) throw new Error('künye doğrulanmadı');
    return d.verified;
  }

  it('özet tutar → indirme gömülü kanal kökünden (indirmeUrl DEĞİL), kurulum ekranı açılır', async () => {
    const doc = await dogrulanmis();
    const asamalar = new Set<string | undefined>();
    const s = await apkIndirVeKur(doc, (_o, a) => asamalar.add(a));
    expect(s).toEqual({ durum: 'basladi' });
    const [url, , secenek] = (FileSystem.createDownloadResumable as jest.Mock).mock.calls[0];
    expect(url).toBe(`${FEED}apk/${AD}`);
    expect(secenek).toEqual({ headers: { 'X-TKL-Indirme': 'belirtec' } });
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledTimes(1);
    expect(asamalar.has('verify')).toBe(true);
  });

  it('indirilen dosya değiştirilmiş → kurulum ekranı AÇILMAZ, dosya silinir, TR mesaj', async () => {
    const doc = await dogrulanmis();
    const b = Buffer.from(APK);
    b[100] ^= 0xff;
    (globalThis as Record<string, unknown>).mockApkBaytlari = b;
    const s = await apkIndirVeKur(doc);
    expect(s.durum).toBe('hata');
    expect(s.durum === 'hata' && s.mesaj).toMatch(/eşleşmiyor; kurulmadı/);
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
    const silinen = (FileSystem.deleteAsync as jest.Mock).mock.calls.map((c) => c[0]);
    expect(silinen.filter((y) => y === 'file:///cache/tekserp-guncelleme.apk').length).toBeGreaterThanOrEqual(2);
  });

  it('künye başka kanalın → indirme bile başlamaz', async () => {
    const doc = await dogrulanmis();
    const s = await apkIndirVeKur({ ...doc, kanal: 'testfabrika' });
    expect(s.durum).toBe('hata');
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalled();
  });
});
