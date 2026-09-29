// PUSH HEDEFİ DOĞRULAMASI — kayıtta VE gönderimde aynı yüklem (tek kaynak). Web push aboneliğinin uç adresi
// istemciden gelir: izinli push servisi dışındaki adres (iç ağ, IP, http) REDDEDİLİR (SSRF kapısı, fail-closed).
import type { DevicePlatform } from "@prisma/client";

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/;
/** Bilinen tarayıcı push servisleri (sonek eşlemesi alan adı SINIRINDA). */
const WEB_PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export interface WebSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

function hostAllowed(host: string): boolean {
  return WEB_PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Web aboneliği (JSON metni) → doğrulanmış abonelik; uymazsa null. */
export function parseWebSubscription(token: string): WebSubscription | null {
  let raw: unknown;
  try {
    raw = JSON.parse(token);
  } catch {
    return null;
  }
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof r.endpoint !== "string" || typeof r.keys?.p256dh !== "string" || typeof r.keys.auth !== "string") return null;
  let url: URL;
  try {
    url = new URL(r.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !hostAllowed(url.hostname.toLowerCase())) return null;
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(r.keys.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(r.keys.auth)) return null;
  return { endpoint: r.endpoint, keys: { p256dh: r.keys.p256dh, auth: r.keys.auth } };
}

/** Platform ↔ belirteç biçimi uyumlu mu (iOS/Android: Expo belirteci · web: izinli servise abonelik). */
export function validPushToken(platform: DevicePlatform, token: string): boolean {
  return platform === "WEB" ? parseWebSubscription(token) !== null : EXPO_TOKEN.test(token);
}
