// Bekçi: denetim Y4 — api.ts interceptor'ı vekilin (nginx/Cloudflare) 5xx'ini ULAŞILAMAZ sayar
// (çevrimdışı yol + createRequestHold), 429/backend 503'ü geçici işaretler; backend JSON 500 eskisi gibi.
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import Toast from 'react-native-toast-message';
import { apiClient } from './api';
import { __resetOnlineSignalForTests, offlineReason } from '../offline/serverReachability';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

type Wrapped = Error & { status?: number; transient?: string; retryAfterMs?: number; details?: unknown };

function failWith(status: number, data: unknown, headers: Record<string, string> = {}) {
  return (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const response = { data, status, statusText: '', headers, config } as AxiosResponse;
    return Promise.reject(new AxiosError(`HTTP ${status}`, 'ERR_BAD_RESPONSE', config, null, response));
  };
}

async function post(adapter: ReturnType<typeof failWith>): Promise<Wrapped> {
  try {
    await apiClient.post('/rolls', { a: 1 }, { adapter });
  } catch (e) {
    return e as Wrapped;
  }
  throw new Error('istek başarılı olmamalıydı');
}

beforeEach(() => {
  __resetOnlineSignalForTests();
  global.fetch = jest.fn(async () => {
    throw new Error('ağ yok');
  }) as unknown as typeof fetch;
  (Toast.show as jest.Mock).mockClear();
});
afterEach(() => __resetOnlineSignalForTests());

describe('api.ts — vekil 5xx / 429 sınıflandırması', () => {
  it('⭐ 502 HTML → çevrimdışı (server), hata geçici "gateway", HTML mesaj sızmaz', async () => {
    const e = await post(failWith(502, '<html><body>502 Bad Gateway</body></html>'));
    expect(offlineReason()).toBe('server');
    expect(e.status).toBe(502);
    expect(e.transient).toBe('gateway');
    expect(e.message).not.toContain('<html');
  });

  it('⭐ 503 HTML (nginx bakım) → çevrimdışı, gateway', async () => {
    const e = await post(failWith(503, '<html>Service Unavailable</html>'));
    expect(offlineReason()).toBe('server');
    expect(e.transient).toBe('gateway');
  });

  it('⭐ Cloudflare 522 → çevrimdışı, gateway', async () => {
    const e = await post(failWith(522, 'error code: 522'));
    expect(offlineReason()).toBe('server');
    expect(e.transient).toBe('gateway');
  });

  it('backend JSON 503 (meşgul) → çevrimiçi kalır, "busy" + Retry-After, meşgul toastı', async () => {
    const e = await post(failWith(503, { success: false, message: 'Sunucu meşgul' }, { 'retry-after': '3' }));
    expect(offlineReason()).toBeNull();
    expect(e.transient).toBe('busy');
    expect(e.retryAfterMs).toBe(3000);
    expect(e.message).toBe('Sunucu meşgul');
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Sunucu şu an meşgul' }));
  });

  it('⭐ 429 Retry-After\'lı → rate-limit, bekleme başlıktan', async () => {
    const e = await post(
      failWith(429, { success: false, message: 'Çok fazla istek', details: { code: 'RATE_LIMITED' } }, { 'retry-after': '17' }),
    );
    expect(offlineReason()).toBeNull();
    expect(e.transient).toBe('rate-limit');
    expect(e.retryAfterMs).toBe(17_000);
  });

  it('429 başlıksız → rate-limit, bekleme details.retryAfterSec ya da yok', async () => {
    const e1 = await post(failWith(429, { success: false, details: { code: 'RATE_LIMITED', retryAfterSec: 5 } }));
    expect(e1.retryAfterMs).toBe(5000);
    const e2 = await post(failWith(429, { success: false, message: 'x' }));
    expect(e2.transient).toBe('rate-limit');
    expect(e2.retryAfterMs).toBeUndefined();
  });

  it('backend JSON 500 → eski davranış: çevrimiçi, geçici değil, backend mesajı', async () => {
    const e = await post(failWith(500, { success: false, message: 'İç hata', details: { code: 'X' } }));
    expect(offlineReason()).toBeNull();
    expect(e.transient).toBeUndefined();
    expect(e.message).toBe('İç hata');
    expect(e.details).toEqual({ code: 'X' });
  });
});
