/**
 * HATA RAPORU (panel) — yakalanmamış hata / React çökmesi backend'e `POST /api/hata-raporlari/istemci` ile bildirilir.
 * MESAJ METNİ GÖNDERİLMEZ: yalnız hata sınıfı (`err.name`), yığın (backend dosya:satır'a indirir) ve ekran yolu
 * (backend şablona indirir). Onay backend'dedir (varsayılan KAPALI → `alindi:false`); oturum yoksa hiç istek atılmaz.
 * Bildirim asla fırlatmaz ve kendi hatasını bildirmez.
 */
import apiClient from "@/services/apiClient";
import { useAuthStore } from "@/store/auth";
import { useTabsStore } from "@/store/tabs";

export const CLIENT_ERROR_ENDPOINT = "/api/hata-raporlari/istemci";
/** İstemci başına dakikada en çok bu kadar bildirim (backend de kullanıcı başına sınırlar). */
export const CLIENT_REPORTS_PER_MINUTE = 10;
const STACK_MAX = 16_000;

export interface ClientErrorBody {
  readonly kaynak: "panel";
  readonly sinif?: string;
  readonly bilesen?: string;
  readonly yol?: string;
  readonly yigin?: string;
}

/** Ham hatadan istek gövdesi — allowlist; `message` ve başka hiçbir alan okunmaz. */
export function buildClientErrorBody(err: unknown, route: string | null, component?: string): ClientErrorBody {
  const e = err as { name?: unknown; stack?: unknown } | null;
  const body: { kaynak: "panel"; sinif?: string; bilesen?: string; yol?: string; yigin?: string } = { kaynak: "panel" };
  if (typeof e?.name === "string" && e.name) body.sinif = e.name.slice(0, 60);
  if (component) body.bilesen = component.slice(0, 60);
  if (route) body.yol = route.split(/[?#]/)[0]!.slice(0, 400);
  if (typeof e?.stack === "string" && e.stack) body.yigin = stripFirstLine(e.stack).slice(0, STACK_MAX);
  return body;
}

/** V8 yığınının ilk satırı `Ad: mesaj`tır — mesaj backend'e hiç gitmesin diye atılır. */
function stripFirstLine(stack: string): string {
  const lines = stack.split("\n");
  return /^\s*at\s/.test(lines[0] ?? "") ? stack : lines.slice(1).join("\n");
}

function activeRoute(): string | null {
  try {
    const s = useTabsStore.getState();
    return s.tabs.find((t) => t.id === s.activeId)?.path ?? null;
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
export function reportClientError(err: unknown, component?: string, now: number = Date.now()): void {
  try {
    if (!useAuthStore.getState().user || sending) return;
    if (now - windowStart >= 60_000) {
      windowStart = now;
      sentInWindow = 0;
    }
    if (sentInWindow >= CLIENT_REPORTS_PER_MINUTE) return;
    sentInWindow++;
    sending = true;
    void apiClient
      .post(CLIENT_ERROR_ENDPOINT, buildClientErrorBody(err, activeRoute(), component), { suppressErrorToast: true })
      .catch(() => undefined)
      .finally(() => {
        sending = false;
      });
  } catch {
    sending = false;
  }
}

let installed = false;

/** Pencere düzeyi yakalayıcılar (bir kez). */
export function installGlobalErrorReporting(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener("error", (ev) => reportClientError(ev.error ?? { name: "WindowError" }, "pencere"));
  target.addEventListener("unhandledrejection", (ev) => reportClientError(ev.reason, "pencere"));
}
