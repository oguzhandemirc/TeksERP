// İnternet kipi servisleri: hata sınıfı → metin, kimlik değişimi engeli, uygulama kanalı doğrulaması tutmazsa kayıt yok.
import { INTERNET_SERVERS_KEY, SERVER_CHANGED_REASON } from '../lib/internet-tls';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { completeInternetPairing, getInternetServers, probeInternetServer, verifyInternetIdentity } from './internetServers';

const mockStore: Record<string, string> = {};
jest.mock('../utils/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockStore[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore[k] = v;
    }),
    deleteItem: jest.fn(async (k: string) => {
      delete mockStore[k];
    }),
  },
}));
const mockProbe = jest.fn();
jest.mock('./lanTlsNative', () => ({ webPkiProbe: () => mockProbe, lanTlsNative: () => null }));
jest.mock('./lanTlsPins', () => ({ pushNativePinState: jest.fn(async () => undefined) }));

const CLOUD = 'tekserp.etkiliyazilim.com';
const IID = '11111111-2222-3333-4444-555555555555';
const REC = { host: CLOUD, port: 443, installationId: IID, addedAt: 'x' };
const idBody = (iid: string) => JSON.stringify({ product: 'TeksERP', installationId: iid, companyName: 'Örnek', version: '1' });

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockProbe.mockReset();
  (global as { fetch?: unknown }).fetch = jest.fn();
});

it('saat / vekil / ad / ağ ayrı metinle döner; izinli alan dışı ad yoklanmaz', async () => {
  for (const [failure, re] of [['clock_behind', /saati geride/], ['untrusted', /denetliyor/], ['name', /eşleşmiyor/], ['network', /ulaşılamadı/]] as const) {
    mockProbe.mockResolvedValueOnce({ failure, status: null, body: null, detail: null });
    const r = await probeInternetServer(CLOUD, 443, 1000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
  }
  expect((await probeInternetServer('203.0.113.7', 443, 1000)).ok).toBe(false);
  expect(mockProbe).toHaveBeenCalledTimes(4);
});

it('doğrulanmış ama TeksERP değil → eklenmez', async () => {
  mockProbe.mockResolvedValueOnce({ failure: null, status: 200, body: '<html>', detail: null });
  const r = await probeInternetServer(CLOUD, 443, 1000);
  expect(r.ok).toBe(false);
});

it('uygulama kanalında kurulum kimliği farklıysa kayıt yazılmaz, adres değişmez', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ status: 200, json: async () => JSON.parse(idBody('baska-0000-0000-0000-000000000000')) });
  const r = await completeInternetPairing({ record: REC, baseUrl: `https://${CLOUD}:443` });
  expect(r).toEqual({ ok: false, reason: expect.stringMatching(/doğrulanan sunucu değil/) });
  expect(mockStore[INTERNET_SERVERS_KEY]).toBeUndefined();
});

it('tutarsa kayıt + adres yazılır; sonra kimlik değişirse adres kullanılamaz olur', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ status: 200, json: async () => JSON.parse(idBody(IID)) });
  expect(await completeInternetPairing({ record: REC, baseUrl: `https://${CLOUD}:443` })).toEqual({ ok: true });
  expect(await getInternetServers()).toEqual([REC]);
  expect(useBaseUrlStore.getState().baseUrl).toBe(`https://${CLOUD}:443/api`);
  (global.fetch as jest.Mock).mockResolvedValue({ status: 200, json: async () => JSON.parse(idBody('baska-0000-0000-0000-000000000000')) });
  await verifyInternetIdentity();
  expect(useBaseUrlStore.getState().baseUrl).toBe('');
  expect(useBaseUrlStore.getState().unusableReason).toBe(SERVER_CHANGED_REASON);
});
