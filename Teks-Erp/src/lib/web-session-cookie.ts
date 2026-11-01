// =============================================================================
// Bulut web paneli — çerez oturumu (sözleşme: docs/design/BULUT-WEB-PANELI.md)
// =============================================================================
// Panel kipi kararı (WEB_DIST_DIR) ve çerez/CSRF okuması YALNIZ burada: giriş, kimlik
// middleware'i, lisans kapısı ve statik sunum aynı yüklemi okur. Bağımlılıksız (cookie-parser yok).
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";

export const WEB_SESSION_COOKIE = "tekserp_oturum";
/** Node başlık adlarını küçük harfe çevirir; tel üstünde `X-TeksERP-CSRF: 1`. */
export const CSRF_HEADER = "x-tekserp-csrf";

/** Panel kipi: WEB_DIST_DIR dolu (boş dizgi/boşluk = kapalı = bugünkü davranış). Her çağrıda taze okunur. */
export function isWebPanelMode(): boolean {
  return (process.env.WEB_DIST_DIR ?? "").trim().length > 0;
}

/** Bu giriş çerez kipinde mi? Yalnız panel kipi + `clientType:"web"`. */
export function cookieLoginApplies(clientType: string | undefined): boolean {
  return clientType === "web" && isWebPanelMode();
}

/** `Cookie` başlığından oturum çerezi (ilk eşleşen); yoksa/çözülemezse null. */
export function readSessionCookie(req: Request): string | null {
  return readNamedCookie(req, WEB_SESSION_COOKIE);
}

function readNamedCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string" || header.length === 0) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/** İstek kimlik bilgisi taşıyor mu (Bearer başlığı ya da oturum çerezi)? Başlık önceliklidir. */
export function hasRequestCredential(req: Request): boolean {
  return Boolean(req.headers.authorization) || readSessionCookie(req) !== null;
}

/** Kimlik bilgisini TEK öncelik kuralıyla oku: Authorization varsa çerez HİÇ okunmaz. */
export function readRequestToken(req: Request): { token: string; via: "bearer" | "cookie" } | null {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    return token ? { token, via: "bearer" } : null;
  }
  const cookie = readSessionCookie(req);
  return cookie ? { token: cookie, via: "cookie" } : null;
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

export function hasCsrfHeader(req: Request): boolean {
  return req.headers[CSRF_HEADER] === "1";
}

const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Strict; Path=/";

/** Max-Age = JWT exp − şimdi (oturum süresiyle hizalı). */
export function setSessionCookie(res: Response, token: string): void {
  const decoded = jwt.decode(token) as { exp?: number } | null;
  const maxAge = Math.max(0, (decoded?.exp ?? 0) - Math.floor(Date.now() / 1000));
  res.append("Set-Cookie", `${WEB_SESSION_COOKIE}=${encodeURIComponent(token)}; ${COOKIE_ATTRS}; Max-Age=${maxAge}`);
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${WEB_SESSION_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`);
}

// ── Güvenilir cihaz çerezi (web "bu cihazı hatırla", 2026-11-01) ──────────────────────────────
// Yol YALNIZ parolalı giriş ucu: başka hiçbir istekte tarayıcı göndermez; oturum yerine geçmez.
export const TRUSTED_DEVICE_COOKIE = "tekserp_cihaz";
export const TRUSTED_DEVICE_COOKIE_PATH = "/api/auth/login";
const TRUSTED_COOKIE_ATTRS = `HttpOnly; Secure; SameSite=Strict; Path=${TRUSTED_DEVICE_COOKIE_PATH}`;

export function readTrustedDeviceCookie(req: Request): string | null {
  return readNamedCookie(req, TRUSTED_DEVICE_COOKIE);
}

/** Güvenilir cihaz belirteci istek gövdesinde taşınırken alan adı (çerezsiz kanal; henüz bağlı değil). */
export const TRUSTED_DEVICE_BODY_FIELD = "trustedDeviceToken";
const TRUSTED_DEVICE_TOKEN_MAX = 256;

/**
 * Belirteci KANALDAN BAĞIMSIZ okur: tarayıcı çerezden, çerezsiz istemci gövde alanından.
 * Doğrulama kaynağa bakmaz (`consumeTrustedDevice`); kaynak yalnız nereden okunacağını seçer.
 */
export function readTrustedDeviceToken(req: Request, source: "cookie" | "body"): string | null {
  let raw: unknown;
  if (source === "cookie") raw = readTrustedDeviceCookie(req);
  else raw = (req.body as Record<string, unknown> | undefined)?.[TRUSTED_DEVICE_BODY_FIELD];
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 && t.length <= TRUSTED_DEVICE_TOKEN_MAX ? t : null;
}

export function setTrustedDeviceCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  res.append("Set-Cookie", `${TRUSTED_DEVICE_COOKIE}=${encodeURIComponent(token)}; ${TRUSTED_COOKIE_ATTRS}; Max-Age=${maxAge}`);
}
