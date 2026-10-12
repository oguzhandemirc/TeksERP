// B6 — tablet `api.ts`: duyurulu sunucu güncellemesinde sunucu yanıtsızken (`offlineReason() === 'server'`) yeni
// istek GÖNDERİLMEDEN bekletilir ve bağlantı gelince gider; duyuru yokken beklemez; yanıtsız düşen kaydın işlem
// kimliği yapışır, ikinci deneme bağlantıyı bekleyip AYNI kimlikle tek kez gider. Ağ: axios adapter + fetch sahte.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '../services/api';
import { __resetOnlineSignalForTests, offlineReason, reportServerUnreachable } from './serverReachability';
import { HEALTH_PROBE_INTERVAL_MS, setOutageTarget } from '../lib/sunucu-kesintisi';
import { createAttemptToken } from './attemptToken';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

let healthy = false;
let failNext = false;
const sent: { url?: string; body: unknown }[] = [];

function adapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  sent.push({ url: config.url, body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
  if (failNext) {
    failNext = false;
    return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config));
  }
  return Promise.resolve({ data: { success: true }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse);
}

beforeEach(() => {
  jest.useFakeTimers();
  healthy = false;
  failNext = false;
  sent.length = 0;
  __resetOnlineSignalForTests();
  global.fetch = jest.fn(async () => {
    if (!healthy) throw new Error('ağ yok');
    return { status: 200 } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => {
  setOutageTarget(null);
  __resetOnlineSignalForTests();
  jest.useRealTimers();
});

const announce = (inMs: number) => setOutageTarget({ atMs: Date.now() + inMs, ongoing: false });

describe('tablet — sunucu kesintisinde istek bekletme', () => {
  it('duyuru etkin + sunucu yanıtsız → gönderilmez; sağlık gelince gider', async () => {
    announce(60_000);
    reportServerUnreachable();
    let done = false;
    const p = apiClient.post('/rolls', { ad: 'x' }, { adapter }).then(() => (done = true));
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS * 2);
    expect(sent).toEqual([]);
    expect(done).toBe(false);
    healthy = true;
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    await p;
    expect(sent).toEqual([{ url: '/rolls', body: { ad: 'x' } }]);
    expect(offlineReason()).toBeNull();
  });

  it('duyuru yokken yanıtsız sunucuda istek beklemeden gider (normal hata yolu)', async () => {
    reportServerUnreachable();
    await apiClient.get('/rolls', { adapter });
    expect(sent.map((s) => s.url)).toEqual(['/rolls']);
  });

  it('yanıtsız düşen kayıt: işlem kimliği yapışır, ikinci deneme bağlantıyı bekler ve AYNI kimlikle gider', async () => {
    announce(60_000);
    failNext = true;
    let n = 0;
    const attempt = createAttemptToken(() => `tok-${++n}`);
    const first = await apiClient.post('/rolls', { clientToken: attempt.token() }, { adapter }).catch((e: unknown) => e);
    attempt.onFailure(first);
    expect(offlineReason()).toBe('server');
    let done = false;
    const second = apiClient.post('/rolls', { clientToken: attempt.token() }, { adapter }).then(() => (done = true));
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    expect(done).toBe(false);
    expect(sent).toHaveLength(1);
    healthy = true;
    await jest.advanceTimersByTimeAsync(HEALTH_PROBE_INTERVAL_MS);
    await second;
    expect(sent.map((s) => (s.body as { clientToken: string }).clientToken)).toEqual(['tok-1', 'tok-1']);
  });
});
