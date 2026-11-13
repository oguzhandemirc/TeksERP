/**
 * Cloudflare Turnstile — YALNIZ tarayıcı (web) derlemesinde ve sunucu korumayı açtıysa (login-methods
 * `turnstileSiteKey`). Electron masaüstünde betik ASLA yüklenmez: panel girişi Bearer'dır, sunucu
 * Turnstile istemez. Belirteç tek kullanımlıktır: her giriş denemesinden sonra widget sıfırlanır.
 */
import { IS_ELECTRON } from "@/lib/runtime-env";

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let scriptPromise: Promise<TurnstileApi> | null = null;
let currentToken: string | null = null;
let widgetId: string | null = null;

/** Betik bir kez eklenir; masaüstünde reddedilir (savunma: çağıran zaten koşullu). */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (IS_ELECTRON) return Promise.reject(new Error("Turnstile masaüstünde yüklenmez"));
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TURNSTILE_SCRIPT_URL;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error("Turnstile yüklenemedi")));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("Turnstile yüklenemedi"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export async function mountTurnstile(el: HTMLElement, siteKey: string, onState: (ready: boolean) => void): Promise<void> {
  const api = await loadTurnstile();
  if (widgetId) api.remove(widgetId);
  currentToken = null;
  widgetId = api.render(el, {
    sitekey: siteKey,
    language: "tr",
    callback: (token: string) => {
      currentToken = token;
      onState(true);
    },
    "expired-callback": () => {
      currentToken = null;
      onState(false);
    },
    "error-callback": () => {
      currentToken = null;
      onState(false);
    },
  });
}

export function unmountTurnstile(): void {
  const api = (window as TurnstileWindow).turnstile;
  if (api && widgetId) api.remove(widgetId);
  widgetId = null;
  currentToken = null;
}

/** Giriş gövdesine eklenecek belirteç (yoksa undefined — sunucu koruma kapalıysa aramaz). */
export function currentTurnstileToken(): string | undefined {
  return currentToken ?? undefined;
}

/** Denemeden sonra: belirteç tüketildi, yenisini üret (TOTP adımı ikinci POST'u yapar). */
export function resetTurnstile(): void {
  if (!widgetId) return;
  currentToken = null;
  (window as TurnstileWindow).turnstile?.reset(widgetId);
}
