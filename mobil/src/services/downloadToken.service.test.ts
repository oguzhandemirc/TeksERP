// =============================================================================
// Bekçi: tablet indirme belirteci (3c) — belirteç backend'den alınır, OTA isteğine `tkl` extra param,
// APK isteğine `X-TKL-Indirme` başlığı olarak gider; alınamazsa başlıksız (bugünkü davranış) ve saklı
// param SİLİNİR. Bağlama kolu: OTA denetimi (servis + UpdateGate) belirteci denetimden ÖNCE tazeler.
//
// NEGATİF SONDA (ölçüldü): otaKontrolEtVeIndir'den tazeleme çağrısı çıkarılınca §3 KIRMIZI;
// UpdateGate'te tazeleme checkForUpdateAsync'in ARKASINA alınınca §4 KIRMIZI.
// =============================================================================

import { readFileSync } from 'fs';
import { join } from 'path';

// jest.mock çağrıları babel-jest ile en üste taşınır; fabrikalar mock* değişkenlerine yalnız çağrı anında dokunur.
import { otaKontrolEtVeIndir } from './appUpdate.service';
import {
  DOWNLOAD_TOKEN_HEADER,
  downloadTokenHeaders,
  fetchDownloadToken,
  refreshOtaDownloadToken,
  type DownloadTokenDeps,
} from './downloadToken.service';

const mockSetExtra = jest.fn(async (_k: string, _v: string | null) => undefined);
const mockCheck = jest.fn(async () => ({ isAvailable: false }));
jest.mock('expo-updates', () => ({
  isEnabled: true,
  updateId: null,
  runtimeVersion: null,
  createdAt: null,
  isEmbeddedLaunch: true,
  reloadAsync: jest.fn(),
  checkForUpdateAsync: (...a: unknown[]) => mockCheck(...(a as [])),
  fetchUpdateAsync: jest.fn(),
  setExtraParamAsync: (k: string, v: string | null) => mockSetExtra(k, v),
}));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: '/tmp/' }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));
jest.mock('./api', () => ({ apiClient: { get: jest.fn() }, resolveAuthToken: jest.fn(async () => null) }));
jest.mock('../store/baseUrlStore', () => ({ getCurrentBaseUrl: () => '' }));
jest.mock('../utils/deviceId', () => ({ getOrCreateDeviceId: jest.fn(async () => 'cihaz') }));
jest.mock('../offline/queryClient', () => ({
  queryClient: { getMutationCache: () => ({ getAll: () => [] }) },
}));

const BELIRTEC = 'eyJhbGciOiJFZERTQSJ9.eyJ0eXAiOiJ0ZWtzZXJwLWluZGlybWUifQ.c2lnbmF0dXJlLWJ5dGVz';

function yanit(durum: number, govde: unknown): Response {
  return { ok: durum >= 200 && durum < 300, status: durum, json: async () => govde } as unknown as Response;
}

function bag(over: Partial<DownloadTokenDeps> = {}): DownloadTokenDeps & { fetchImpl: jest.Mock } {
  return {
    baseUrl: () => 'http://192.168.1.10:4000/api/',
    authToken: async () => 'oturum-jwt',
    deviceId: async () => 'cihaz-1',
    fetchImpl: jest.fn(async () => yanit(200, { data: { belirtec: BELIRTEC } })),
    ...over,
  } as DownloadTokenDeps & { fetchImpl: jest.Mock };
}

beforeEach(() => {
  mockSetExtra.mockClear();
  mockCheck.mockClear();
});

describe('§1 fetchDownloadToken', () => {
  it('fabrika ucundan urun=mobil ile alır; oturum + cihaz başlığı taşır', async () => {
    const b = bag();
    expect(await fetchDownloadToken(b)).toBe(BELIRTEC);
    const [url, init] = b.fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.10:4000/api/license/indirme-belirteci?urun=mobil');
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer oturum-jwt');
    expect(h['x-device-id']).toBe('cihaz-1');
  });

  it('K1 403 / 404 / ağ hatası / biçimsiz gövde → null (asla atmaz)', async () => {
    for (const f of [
      async () => yanit(403, { details: { code: 'LICENSE_UPDATES_FROZEN' } }),
      async () => yanit(404, {}),
      async () => { throw new Error('ağ'); },
      async () => yanit(200, { data: { belirtec: 'duz-metin' } }),
      async () => yanit(200, null),
    ]) {
      expect(await fetchDownloadToken(bag({ fetchImpl: jest.fn(f) as unknown as typeof fetch }))).toBeNull();
    }
  });

  it('ne oturum ne cihaz yoksa ve taban URL geçersizse istek hiç atılmaz', async () => {
    const b1 = bag({ authToken: async () => null, deviceId: async () => null });
    expect(await fetchDownloadToken(b1)).toBeNull();
    expect(b1.fetchImpl).not.toHaveBeenCalled();
    const b2 = bag({ baseUrl: () => '' });
    expect(await fetchDownloadToken(b2)).toBeNull();
    expect(b2.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('§2 OTA param ve APK başlığı', () => {
  it('belirteç varsa tkl yazılır; yoksa saklı param SİLİNİR (null)', async () => {
    await refreshOtaDownloadToken(bag());
    expect(mockSetExtra).toHaveBeenLastCalledWith('tkl', BELIRTEC);
    await refreshOtaDownloadToken(bag({ fetchImpl: jest.fn(async () => yanit(403, {})) as unknown as typeof fetch }));
    expect(mockSetExtra).toHaveBeenLastCalledWith('tkl', null);
  });

  it('APK başlığı X-TKL-Indirme; belirteç yoksa boş nesne', async () => {
    expect(DOWNLOAD_TOKEN_HEADER).toBe('X-TKL-Indirme');
    expect(await downloadTokenHeaders(bag())).toEqual({ 'X-TKL-Indirme': BELIRTEC });
    expect(await downloadTokenHeaders(bag({ authToken: async () => null, deviceId: async () => null }))).toEqual({});
  });
});

describe('§3 otaKontrolEtVeIndir — param denetimden ÖNCE tazelenir', () => {
  it('setExtraParamAsync checkForUpdateAsync\'ten önce çağrılır', async () => {
    const sira: string[] = [];
    mockSetExtra.mockImplementationOnce(async () => { sira.push('param'); });
    mockCheck.mockImplementationOnce(async () => { sira.push('denetim'); return { isAvailable: false }; });
    await otaKontrolEtVeIndir();
    expect(sira).toEqual(['param', 'denetim']);
  });
});

describe('§4 UpdateGate — kaynak bağlaması', () => {
  const src = readFileSync(join(__dirname, '../components/UpdateGate.tsx'), 'utf8');
  it('sor(): tazeleme checkForUpdateAsync\'ten önce; açılışta gecikmeli yeniden deneme var', () => {
    const tazele = src.indexOf('await refreshOtaDownloadToken()');
    const denetim = src.indexOf('Updates.checkForUpdateAsync()');
    expect(tazele).toBeGreaterThan(-1);
    expect(denetim).toBeGreaterThan(tazele);
    expect(src).toMatch(/setTimeout\(\(\) => void sor\(\), LAUNCH_RETRY_DELAY_MS\)/);
  });
});
