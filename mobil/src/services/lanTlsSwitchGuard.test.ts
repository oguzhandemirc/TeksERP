// Bekçi: sabitli sunucuya şifresiz adresle geçiş engellenir (docs/design/LAN-TLS.md §6, kullanıcı kararı 2026-10-07).
// ⭐ Aynı makine ya da aynı kurulum kimliği + http → engel ve kararlaştırılan cümle.
// ⭐ https, başka sunucu ve sabit kaldırıldıktan sonra http serbest — sabit sunucu başınadır.
import { HTTP_TO_PINNED_REASON, type TlsPin } from '../lib/lan-tls';
import { useBaseUrlStore } from '../store/baseUrlStore';
import { probeServer } from './discovery.service';
import { addTlsPin, removeTlsPins } from './lanTlsPins';
import { httpSwitchBlock } from './lanTlsSwitchGuard';

const mockMem = new Map<string, string>();
jest.mock('../utils/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    deleteItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));
jest.mock('./lanTlsNative', () => ({ lanTlsNative: jest.fn(() => null) }));
jest.mock('./discovery.service', () => ({ probeServer: jest.fn() }));

const probeMock = probeServer as jest.MockedFunction<typeof probeServer>;
const FP = 'ab'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const OTHER_IID = '99999999-2222-3333-4444-555555555555';
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: 'qr', pinnedAt: '' };

function serverWith(installationId: string | null) {
  probeMock.mockResolvedValue({
    baseUrl: 'http://x:4000',
    host: 'x',
    port: 4000,
    identity: installationId
      ? { product: 'TeksERP', discoveryVersion: 1, installationId, serverName: 's', companyName: 'c', version: '1' }
      : null,
    rttMs: 1,
    matchesPinned: 'unknown',
    tls: { port: 4443, fingerprint: FP },
  });
}

beforeEach(async () => {
  mockMem.clear();
  probeMock.mockReset();
  serverWith(null);
  useBaseUrlStore.setState({ baseUrl: 'https://192.168.1.50:4443/api', isLoaded: true });
  await addTlsPin(PIN);
});

it('sabitli makine + http → engellenir, cümle kararlaştırılan', async () => {
  const block = await httpSwitchBlock('http://192.168.1.50:4000/api');
  expect(block?.reason).toBe(
    "Bu sunucuya şifreli bağlanılıyor; şifresiz adrese geçmek için önce 'Şifreli bağlantıyı kaldır'",
  );
  expect(block?.reason).toBe(HTTP_TO_PINNED_REASON);
  expect(block?.pin.installationId).toBe(IID);
  expect(block?.url).toBe('http://192.168.1.50:4000/api');
});

it('başka adresteki aynı kurulum (kimlik sabitle aynı) + http → engellenir', async () => {
  serverWith(IID);
  const block = await httpSwitchBlock('http://192.168.1.77:4000/api');
  expect(block?.reason).toBe(HTTP_TO_PINNED_REASON);
});

it('sabitli makine + https (aynı parmak izi) → serbest, yoklama bile yok', async () => {
  expect(await httpSwitchBlock('https://192.168.1.50:4443/api')).toBeNull();
  expect(probeMock).not.toHaveBeenCalled();
});

it('başka sunucu + http → serbest (yeni sunucu sabitsiz başlar)', async () => {
  serverWith(OTHER_IID);
  expect(await httpSwitchBlock('http://192.168.1.60:4000/api')).toBeNull();
  serverWith(null);
  expect(await httpSwitchBlock('http://192.168.1.60:4000/api')).toBeNull();
});

it('"Şifreli bağlantıyı kaldır"dan sonra aynı makineye http serbest', async () => {
  await removeTlsPins(IID);
  expect(await httpSwitchBlock('http://192.168.1.50:4000/api')).toBeNull();
});
