// Yalnız şifreli kip (K3, sürüm paketi): şifresiz ya da sabitsiz kayıtlı adres kullanılmaz, http kaydedilmez.
import { INSECURE_ADDRESS_REASON, TLS_PINS_KEY, type TlsPin } from '../lib/lan-tls';

const mockMem = new Map<string, string>();
jest.mock('../utils/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockMem.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void mockMem.set(k, v)),
    deleteItem: jest.fn(async (k: string) => void mockMem.delete(k)),
  },
}));
let mockSecure = true;
jest.mock('../lib/secure-transport', () => ({ secureTransportOnly: () => mockSecure }));

// eslint-disable-next-line import/first
import { useBaseUrlStore } from './baseUrlStore';

const PIN: TlsPin = { installationId: 'i-1', fingerprint: 'ab'.repeat(32), port: 4443, via: 'kod', pinnedAt: '' };
const CUSTOM_KEY = 'api_base_url_custom';

beforeEach(() => {
  mockMem.clear();
  mockSecure = true;
  useBaseUrlStore.setState({ baseUrl: '', customUrl: null, recentUrls: [], isLoaded: false, unusableUrl: null });
});

describe('init', () => {
  it('kayıtlı http adres kullanılmaz → baseUrl boş, unusableUrl dolu', async () => {
    mockMem.set(CUSTOM_KEY, 'http://192.168.1.20:4000/api');
    await useBaseUrlStore.getState().init();
    expect(useBaseUrlStore.getState().baseUrl).toBe('');
    expect(useBaseUrlStore.getState().unusableUrl).toBe('http://192.168.1.20:4000/api');
  });
  it('sabitsiz https adres de kullanılmaz; sabitli olan kullanılır', async () => {
    mockMem.set(CUSTOM_KEY, 'https://192.168.1.20:4443/api');
    await useBaseUrlStore.getState().init();
    expect(useBaseUrlStore.getState().baseUrl).toBe('');
    mockMem.set(TLS_PINS_KEY, JSON.stringify([PIN]));
    await useBaseUrlStore.getState().init();
    expect(useBaseUrlStore.getState().baseUrl).toBe('https://192.168.1.20:4443/api');
    expect(useBaseUrlStore.getState().unusableUrl).toBeNull();
  });
  it('geliştirme kipinde http adres aynen kullanılır', async () => {
    mockSecure = false;
    mockMem.set(CUSTOM_KEY, 'http://192.168.1.20:4000/api');
    await useBaseUrlStore.getState().init();
    expect(useBaseUrlStore.getState().baseUrl).toBe('http://192.168.1.20:4000/api');
  });
});

describe('setCustomUrl', () => {
  it('http adres reddedilir ve hiçbir şey yazılmaz', async () => {
    await expect(useBaseUrlStore.getState().setCustomUrl('http://192.168.1.20:4000')).rejects.toThrow(INSECURE_ADDRESS_REASON);
    expect(mockMem.size).toBe(0);
  });
  it('https adres kaydedilir', async () => {
    await useBaseUrlStore.getState().setCustomUrl('https://192.168.1.20:4443');
    expect(useBaseUrlStore.getState().baseUrl).toMatch(/^https:\/\/192\.168\.1\.20:4443/);
  });
});
