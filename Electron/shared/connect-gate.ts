// Panelin "connect-src"i — ağ isteğinin gidebileceği köken kümesi (T2 bulgusu, 2026-10-25).
// Masaüstünde sunucu adresi ÇALIŞMA ANINDA değişir (ayar, keşif, şifreli geçiş); dosyadan yüklenen
// belgenin meta CSP'si bunu bilemez. Bu yüzden daraltma ana süreçte uygulanır: renderer'ın isteği
// yalnız döngü adresine ya da uygulamanın kendi yapılandırdığı sunucu kökenine gider.
import { isLoopbackHost } from "./lan-tls.js";

/** Bir oturumda tutulacak en fazla köken — yapılandırılmış sunucu + denenen adresler için bol. */
export const CONNECT_GATE_MAX_ORIGINS = 32;

/** Ağ isteği kökeni: `https://host:port` (ws→http, wss→https; varsayılan port açık). Ağ şeması değilse null. */
export function connectOrigin(url: string): string | null {
  let u: URL;
  try {
    u = new URL((url ?? "").trim());
  } catch {
    return null;
  }
  const scheme = u.protocol === "ws:" ? "http:" : u.protocol === "wss:" ? "https:" : u.protocol;
  if (scheme !== "http:" && scheme !== "https:") return null;
  const port = u.port || (scheme === "https:" ? "443" : "80");
  return `${scheme}//${u.hostname.toLowerCase()}:${port}`;
}

/**
 * Renderer'ın ağ isteği gidebilir mi: ağ dışı şema (file/data/blob/devtools) bu kapının dışında,
 * döngü adresi her zaman serbest (geliştirme + yerel sunucu), gerisi yalnız izinli kökenlerde.
 */
export function connectAllowed(url: string, allowed: ReadonlySet<string>): boolean {
  const origin = connectOrigin(url);
  if (origin === null) return !/^\s*(https?|wss?):/i.test(url ?? "");
  if (isLoopbackHost(new URL(url.trim()).hostname)) return true;
  return allowed.has(origin);
}

/** index.html meta CSP'sinin `connect-src` yönergesini verilen kaynaklarla değiştirir (yönerge yoksa dokunmaz). */
export function replaceConnectSrc(html: string, sources: readonly string[]): string {
  return html.replace(/connect-src [^;"]*;/, `connect-src ${sources.join(" ")};`);
}

/**
 * Web derlemesinin connect-src'i — sunucu derlemede bilinir: aynı köken ('self'), açık
 * `VITE_WEB_API_BASE_URL` kökeni; geliştirmede (5175 → 4000) yalnız döngü adresi.
 */
export function webConnectSources(opts: { dev: boolean; apiBaseUrl?: string | null }): string[] {
  const out = ["'self'", "data:"];
  const origin = opts.apiBaseUrl ? connectOrigin(opts.apiBaseUrl) : null;
  if (origin) out.push(origin);
  if (opts.dev) out.push("http://localhost:*", "http://127.0.0.1:*");
  return out;
}
