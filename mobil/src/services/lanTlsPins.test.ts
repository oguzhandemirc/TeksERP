// Bekçi: şifreli bağlantı sabitlerinin native zorlama katmanına köprüsü (docs/design/LAN-TLS.md §6, D5).
// ⭐ Native yoksa hiçbir şey itilmez (bugünkü tabletler değişmez); varsa her sabit/adres değişikliğinde
//    GÜNCEL küme sırayla itilir; sabitli uç yalnız adres https ve portu sabitin portuyken gider.
import { lanTlsNative, type LanTlsNative } from './lanTlsNative';
import {
  __resetLanTlsSyncForTests,
  addTlsPin,
  getTlsPins,
  pushNativePinState,
  removeTlsPins,
  startLanTlsNativeSync,
} from './lanTlsPins';
import { useBaseUrlStore } from '../store/baseUrlStore';
import type { TlsPin } from '../lib/lan-tls';

const mockMem = new Map<string, string>();
jest.mock('../utils/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    deleteItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));
jest.mock('./lanTlsNative', () => ({ lanTlsNative: jest.fn(() => null) }));

const nativeMock = lanTlsNative as jest.MockedFunction<typeof lanTlsNative>;
const FP = 'ab'.repeat(32);
const FP2 = 'cd'.repeat(32);
const IID = '11111111-2222-3333-4444-555555555555';
const PIN: TlsPin = { installationId: IID, fingerprint: FP, port: 4443, via: 'qr', pinnedAt: '' };

function nativeVar(impl?: (fps: string[], eps: string[]) => Promise<void>) {
  const setPinState = jest.fn(impl ?? (async () => undefined));
  const mod: LanTlsNative = { setPinState, getPinState: () => ({ installed: true, fingerprints: [], endpoints: [] }) };
  nativeMock.mockReturnValue(mod);
  return setPinState;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockMem.clear();
  nativeMock.mockReturnValue(null);
  __resetLanTlsSyncForTests();
  useBaseUrlStore.setState({ baseUrl: 'https://192.168.1.50:4443/api', isLoaded: true });
});

describe('native yok', () => {
  it('sabit depoya yazılır ama hiçbir yere itilmez; eşitleme başlamaz', async () => {
    const sub = jest.spyOn(useBaseUrlStore, 'subscribe');
    await addTlsPin(PIN);
    expect(await getTlsPins()).toEqual([PIN]);
    startLanTlsNativeSync();
    expect(sub).not.toHaveBeenCalled();
    await expect(pushNativePinState()).resolves.toBeUndefined();
    sub.mockRestore();
  });
});

describe('native var', () => {
  it('sabit eklenince parmak izi + sabitli uç itilir', async () => {
    const set = nativeVar();
    await addTlsPin(PIN);
    expect(set).toHaveBeenLastCalledWith([FP], ['192.168.1.50:4443']);
  });

  it('adres http iken sabitli uç gitmez (yalnız parmak izi)', async () => {
    useBaseUrlStore.setState({ baseUrl: 'http://192.168.1.50:4000/api' });
    const set = nativeVar();
    await addTlsPin(PIN);
    expect(set).toHaveBeenLastCalledWith([FP], []);
  });

  it('sabit kaldırılınca boş küme itilir (HTTP kilidi kalkar)', async () => {
    const set = nativeVar();
    await addTlsPin(PIN);
    await removeTlsPins(IID);
    expect(set).toHaveBeenLastCalledWith([], []);
    expect(mockMem.has('api_server_tls_pins')).toBe(false);
  });

  it('native reddederse hata yükselir (kart https adresine GEÇMEZ)', async () => {
    nativeVar(async () => {
      throw new Error('geçersiz');
    });
    await expect(addTlsPin(PIN)).rejects.toThrow('geçersiz');
  });

  it('itmeler sırayla koşar; geç biten eski itme yeni kümeyi ezemez', async () => {
    const calls: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    nativeVar(async (fps) => {
      calls.push(fps);
      if (calls.length === 1) await gate;
    });
    mockMem.set('api_server_tls_pins', JSON.stringify([PIN]));
    const first = pushNativePinState();
    await flush(); // ilk itme native'de takılı
    mockMem.set('api_server_tls_pins', JSON.stringify([{ ...PIN, fingerprint: FP2 }]));
    const second = pushNativePinState();
    await flush();
    expect(calls).toEqual([[FP]]);
    release();
    await Promise.all([first, second]);
    expect(calls).toEqual([[FP], [FP2]]);
  });
});

describe('açılış eşitlemesi', () => {
  it('adres yüklenmeden itmez; yüklenince ve adres değişince iter; aynı adreste tekrar itmez', async () => {
    mockMem.set('api_server_tls_pins', JSON.stringify([PIN]));
    useBaseUrlStore.setState({ baseUrl: '', isLoaded: false });
    const set = nativeVar();
    startLanTlsNativeSync();
    await flush();
    expect(set).not.toHaveBeenCalled();

    useBaseUrlStore.setState({ baseUrl: 'https://192.168.1.50:4443/api', isLoaded: true });
    await flush();
    expect(set).toHaveBeenLastCalledWith([FP], ['192.168.1.50:4443']);

    // DHCP: sunucu yeni adreste — sabitli uç da taşınır.
    useBaseUrlStore.setState({ baseUrl: 'https://192.168.1.60:4443/api' });
    await flush();
    expect(set).toHaveBeenLastCalledWith([FP], ['192.168.1.60:4443']);

    const n = set.mock.calls.length;
    useBaseUrlStore.setState({ recentUrls: ['x'] });
    await flush();
    expect(set.mock.calls.length).toBe(n);

    startLanTlsNativeSync(); // ikinci çağrı ikinci abonelik açmaz
    useBaseUrlStore.setState({ baseUrl: 'https://192.168.1.70:4443/api' });
    await flush();
    expect(set.mock.calls.length).toBe(n + 1);
  });
});
