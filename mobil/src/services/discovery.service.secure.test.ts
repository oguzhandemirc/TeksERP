// Yalnız şifreli kip (K3): keşif HTTP istemez, sunucuyu native TLS yoklamasıyla 4443'te (ya da QR'daki portta)
// arar, yedek HTTP portları denenmez; ekleme akışı (tlsRoute:false) izi sabitle tutmayan sunucuyu da görür.
import NetInfo from '@react-native-community/netinfo';

import type { TlsPin } from '../lib/lan-tls';
import { discoverServers } from './discovery.service';
import { probeTlsServer } from './tlsProbe';

jest.mock('../constants/api', () => ({ API_URL: '' }));
jest.mock('../lib/secure-transport', () => ({ secureTransportOnly: () => true }));
jest.mock('./tlsProbe', () => ({ probeTlsServer: jest.fn() }));
const mockPins: { list: TlsPin[] } = { list: [] };
jest.mock('./lanTlsPins', () => ({ getTlsPins: jest.fn(async () => mockPins.list) }));

const FP = 'ab'.repeat(32);
const IDENTITY = { product: 'TeksERP' as const, discoveryVersion: 1, installationId: 'iid-1', serverName: 'SRV', companyName: 'Örnek', version: '2.0.0' };
const probeMock = probeTlsServer as jest.MockedFunction<typeof probeTlsServer>;
const tried: string[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  tried.length = 0;
  mockPins.list = [];
  (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true, isInternetReachable: true, details: { ipAddress: '192.168.1.42', subnet: '255.255.255.0' } });
  global.fetch = jest.fn(async () => {
    throw new Error('HTTP istenmemeli');
  }) as never;
  probeMock.mockImplementation(async (host, port) => {
    tried.push(`${host}:${port}`);
    return host === '192.168.1.250' && port === 4443
      ? { host, port, fingerprint: FP, installationId: 'iid-1', identity: IDENTITY, rttMs: 5 }
      : null;
  });
});

it('sunucu native TLS yoklamasıyla 4443te bulunur, https adres + iz taşır; HTTP isteği yok', async () => {
  const res = await discoverServers({ mode: 'explicit', fullSweep: true, extraPorts: true });
  expect(res.candidates.map((c) => [c.baseUrl, c.tls?.fingerprint])).toEqual([['https://192.168.1.250:4443', FP]]);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(res.scan.ports).toEqual([4443]);
  expect(tried.every((t) => t.endsWith(':4443'))).toBe(true);
});

it("QR'daki port taranır", async () => {
  await discoverServers({ mode: 'explicit', fullSweep: true, tlsPort: 9443 });
  expect(tried.length).toBeGreaterThan(0);
  expect(tried.every((t) => t.endsWith(':9443'))).toBe(true);
});

it('ekleme akışı (tlsRoute:false) izi sabitle tutmayan sunucuyu da listeler', async () => {
  mockPins.list = [{ installationId: 'iid-1', fingerprint: 'cd'.repeat(32), port: 4443, via: 'qr', pinnedAt: '' }];
  const res = await discoverServers({ mode: 'explicit', fullSweep: true, tlsRoute: false });
  expect(res.candidates).toHaveLength(1);
  // körlük zemini: varsayılan yönlendirme aynı sunucuyu listelemez
  const routed = await discoverServers({ mode: 'explicit', fullSweep: true });
  expect(routed.candidates).toHaveLength(0);
});
