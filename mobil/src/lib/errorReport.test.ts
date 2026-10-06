// Bekçi: tablet hata raporu MESAJ taşımaz, oturumsuz istek atmaz, hız sınırlıdır, önceki küresel işleyiciyi korur.
import { useAuthStore } from '../store/authStore';
import {
  CLIENT_ERROR_ENDPOINT,
  CLIENT_REPORTS_PER_MINUTE,
  buildClientErrorBody,
  installGlobalErrorReporting,
  reportClientError,
  resetClientErrorReportingForTest,
} from './errorReport';

const mockPost = jest.fn();
jest.mock('../services/api', () => ({ apiClient: { post: (...a: unknown[]) => mockPost(...a) } }));
jest.mock('../navigation/navigationRef', () => ({ rootNavigationRef: { isReady: () => true, getCurrentRoute: () => ({ name: 'Kk1Scan' }) } }));

const GIZLI = 'Ahmet Yılmaz topu ahmet@firma.com okunamadı';
function hata(): Error {
  const e = new TypeError(GIZLI);
  e.stack = `TypeError: ${GIZLI}\n    at Kk1Scan (index.android.bundle:42:7)`;
  return e;
}
const IZINLI = new Set(['kaynak', 'surum', 'sinif', 'bilesen', 'yigin']);

beforeEach(() => {
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: { success: true, data: { alindi: true } } });
  resetClientErrorReportingForTest();
  useAuthStore.setState({ token: 't', user: { userId: 'u1' } as never });
});

describe('tablet hata raporu', () => {
  it('gövde yalnız allowlist alanları; MESAJ metni hiçbir alanda yok', () => {
    const b = buildClientErrorBody(hata(), 'Kk1Scan');
    expect(Object.keys(b).every((k) => IZINLI.has(k))).toBe(true);
    expect(JSON.stringify(b)).not.toContain('Ahmet');
    expect(JSON.stringify(b)).not.toContain('firma.com');
    expect(b.yigin).toContain('index.android.bundle:42');
    expect(b.kaynak).toBe('tablet');
  });

  it('oturumluysa uca gider (ekran adı bileşen), oturumsuzsa istek yok', () => {
    reportClientError(hata());
    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect(body['bilesen']).toBe('Kk1Scan');
    expect(JSON.stringify(body)).not.toContain('Ahmet');
    mockPost.mockClear();
    resetClientErrorReportingForTest();
    useAuthStore.setState({ token: null, user: null });
    reportClientError(hata());
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('dakikalık hız sınırı; bildirim hatası yutulur', async () => {
    mockPost.mockRejectedValue(new Error('ağ yok'));
    for (let i = 0; i < CLIENT_REPORTS_PER_MINUTE + 5; i++) {
      reportClientError(hata(), 1000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(mockPost).toHaveBeenCalledTimes(CLIENT_REPORTS_PER_MINUTE);
  });

  it('küresel işleyici: önceki işleyici aynen çağrılır', () => {
    const previous = jest.fn();
    let handler: ((e: unknown, f?: boolean) => void) | null = null;
    installGlobalErrorReporting({ getGlobalHandler: () => previous, setGlobalHandler: (fn) => { handler = fn; } });
    const e = hata();
    handler!(e, true);
    expect(previous).toHaveBeenCalledWith(e, true);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
