// Sunucu ekleme sonu: sabit önce yazılır, kimlik sabitli kanaldan okunur; okunamaz ya da tutmazsa sabit geri,
// adres değişmez. Başarıda https adres + sabit + kurulum kimliği.
import type { TlsPin } from '../lib/lan-tls';

const mockPins: { list: TlsPin[] } = { list: [] };
const mockStore = { setCustomUrl: jest.fn(async () => undefined) };
jest.mock('./lanTlsPins', () => ({
  lanTlsNativeAvailable: () => true,
  getTlsPins: jest.fn(async () => [...mockPins.list]),
  addTlsPin: jest.fn(async (p: TlsPin) => (mockPins.list = [...mockPins.list, p])),
  restoreTlsPins: jest.fn(async (p: TlsPin[]) => void (mockPins.list = [...p])),
  pushNativePinState: jest.fn(async () => undefined),
}));
jest.mock('../store/baseUrlStore', () => ({
  setPinnedInstallationId: jest.fn(async () => undefined),
  useBaseUrlStore: { getState: () => mockStore },
}));
jest.mock('./tlsProbe', () => ({ NATIVE_MISSING_REASON: 'yok' }));

// eslint-disable-next-line import/first
import { completePairing } from './serverPairing';
// eslint-disable-next-line import/first
import { setPinnedInstallationId } from '../store/baseUrlStore';

const IID = 'kurulum-1';
const PIN: TlsPin = { installationId: IID, fingerprint: 'ab'.repeat(32), port: 4443, via: 'kod', pinnedAt: 'x' };
const DECISION = { pin: PIN, baseUrl: 'https://192.168.1.50:4443' };
const OLD: TlsPin = { ...PIN, installationId: 'eski', fingerprint: 'cd'.repeat(32) };

function fetchReturns(body: unknown, status = 200) {
  global.fetch = jest.fn(async () => ({ status, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => {
  mockPins.list = [OLD];
  mockStore.setCustomUrl.mockClear();
  (setPinnedInstallationId as jest.Mock).mockClear();
});

it('kimlik okunamazsa sabit geri alınır, adres yazılmaz', async () => {
  global.fetch = jest.fn(async () => {
    throw new Error('tls');
  }) as unknown as typeof fetch;
  const r = await completePairing(DECISION);
  expect(r.ok).toBe(false);
  expect(mockPins.list).toEqual([OLD]);
  expect(mockStore.setCustomUrl).not.toHaveBeenCalled();
});

it('başka kurulumun kimliği gelirse red, sabit geri', async () => {
  fetchReturns({ product: 'TeksERP', installationId: 'baska' });
  const r = await completePairing(DECISION);
  expect(r).toEqual({ ok: false, reason: expect.stringMatching(/doğrulanan sunucu değil/) });
  expect(mockPins.list).toEqual([OLD]);
  expect(mockStore.setCustomUrl).not.toHaveBeenCalled();
});

it('başarı: kimlik sabitli kanaldan (https) okunur, adres + sabit + kurulum kimliği yazılır', async () => {
  fetchReturns({ product: 'TeksERP', installationId: IID });
  const r = await completePairing(DECISION);
  expect(r).toEqual({ ok: true });
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://192.168.1.50:4443/api/discovery/identity');
  expect(mockPins.list).toEqual([OLD, PIN]);
  expect(setPinnedInstallationId).toHaveBeenCalledWith(IID);
  expect(mockStore.setCustomUrl).toHaveBeenCalledWith('https://192.168.1.50:4443');
});

it('kimliksiz QR/kod: sunucunun bildirdiği kimlik sabite işlenir', async () => {
  fetchReturns({ product: 'TeksERP', installationId: 'yeni' });
  const r = await completePairing({ ...DECISION, pin: { ...PIN, installationId: null } });
  expect(r).toEqual({ ok: true });
  expect(mockPins.list).toEqual([OLD, { ...PIN, installationId: 'yeni' }]);
  expect(setPinnedInstallationId).toHaveBeenCalledWith('yeni');
});
