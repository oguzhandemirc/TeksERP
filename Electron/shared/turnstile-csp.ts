// Web derlemesinin meta CSP'sine Cloudflare Turnstile kökeni (V1c): betik + çerçeve. Yalnız `vite.config.web.ts`
// uygular — Electron'un index.html CSP'si değişmez (masaüstü Turnstile yüklemez). Sunucu başlığı `app.ts`te aynı.
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** `script-src` ve `frame-src` yönergelerine kökeni ekler (yönerge yoksa dokunmaz; idempotent). */
export function addTurnstileSources(html: string): string {
  return html.replace(/(script-src|frame-src) ([^;"]*);/g, (whole, name: string, list: string) =>
    list.split(/\s+/).includes(TURNSTILE_ORIGIN) ? whole : `${name} ${list} ${TURNSTILE_ORIGIN};`,
  );
}
