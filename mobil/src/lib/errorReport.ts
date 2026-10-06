// HATA RAPORU (tablet) — yakalanmamış JS hatası backend'e `POST /api/hata-raporlari/istemci` ile bildirilir.
// MESAJ METNİ GÖNDERİLMEZ: yalnız sınıf (`err.name`), yığın (backend dosya:satır'a indirir) ve ekran adı. Onay
// backend'dedir (varsayılan KAPALI); oturum yoksa istek atılmaz; bildirim asla fırlatmaz, önceki işleyici korunur.
import { apiClient } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { rootNavigationRef } from '../navigation/navigationRef';

export const CLIENT_ERROR_ENDPOINT = '/api/hata-raporlari/istemci';
/** Tablet başına dakikada en çok bu kadar bildirim (backend de kullanıcı başına sınırlar). */
export const CLIENT_REPORTS_PER_MINUTE = 10;
const STACK_MAX = 16_000;

export interface ClientErrorBody {
  readonly kaynak: 'tablet';
  readonly sinif?: string;
  readonly bilesen?: string;
  readonly yigin?: string;
}

/** Ham hatadan istek gövdesi — allowlist; `message` ve başka hiçbir alan okunmaz. */
export function buildClientErrorBody(err: unknown, component: string | null): ClientErrorBody {
  const e = err as { name?: unknown; stack?: unknown } | null;
  const body: { kaynak: 'tablet'; sinif?: string; bilesen?: string; yigin?: string } = { kaynak: 'tablet' };
  if (typeof e?.name === 'string' && e.name) body.sinif = e.name.slice(0, 60);
  if (component) body.bilesen = component.slice(0, 60);
  if (typeof e?.stack === 'string' && e.stack) body.yigin = stripMessageLine(e.stack).slice(0, STACK_MAX);
  return body;
}

/** V8/Hermes yığınının ilk satırı `Ad: mesaj`tır — atılır; JSC biçiminde (`fn@dosya:satır`) mesaj satırı yoktur. */
function stripMessageLine(stack: string): string {
  const lines = stack.split('\n');
  const first = lines[0] ?? '';
  return /^\s*at\s/.test(first) || /^[^\s@]*@\S+:\d+(?::\d+)?$/.test(first.trim()) ? stack : lines.slice(1).join('\n');
}

function activeScreen(): string | null {
  try {
    return rootNavigationRef.isReady() ? (rootNavigationRef.getCurrentRoute()?.name ?? null) : null;
  } catch {
    return null;
  }
}

let windowStart = 0;
let sentInWindow = 0;
let sending = false;

/** Bekçi düzeneği: hız sınırını sıfırlar. */
export function resetClientErrorReportingForTest(): void {
  windowStart = 0;
  sentInWindow = 0;
  sending = false;
}

/** Hata bildirimi — oturum yoksa, hız sınırında ya da bildirim sürerken hiçbir şey yapmaz; asla fırlatmaz. */
export function reportClientError(err: unknown, now: number = Date.now()): void {
  try {
    if (!useAuthStore.getState().token || sending) return;
    if (now - windowStart >= 60_000) {
      windowStart = now;
      sentInWindow = 0;
    }
    if (sentInWindow >= CLIENT_REPORTS_PER_MINUTE) return;
    sentInWindow++;
    sending = true;
    void apiClient
      .post(CLIENT_ERROR_ENDPOINT, buildClientErrorBody(err, activeScreen()))
      .catch(() => undefined)
      .finally(() => {
        sending = false;
      });
  } catch {
    sending = false;
  }
}

interface GlobalErrorUtils {
  getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler: (fn: (error: unknown, isFatal?: boolean) => void) => void;
}

let installed = false;

/** RN küresel hata işleyicisine bağlanır (bir kez); önceki işleyici (kırmızı ekran / çökme) aynen çağrılır. */
export function installGlobalErrorReporting(utils: GlobalErrorUtils | undefined = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils): void {
  if (installed || !utils) return;
  installed = true;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    reportClientError(error);
    previous(error, isFatal);
  });
}
