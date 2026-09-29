// İNDİRME BELİRTECİ (3b) — panel her güncelleme denetiminden önce fabrikanın backend'inden kısa ömürlü
// belirteç alır ve electron-updater'a `X-TKL-Indirme` başlığı olarak verir (latest.yml + exe + blockmap).
// Belirteç alınamazsa denetim BAŞLIKSIZ yapılır (bugünkü davranış): Worker açılana dek sorunsuz, sonra
// geçiş listesi. Belirteç loglanmaz, diske yazılmaz. Sözleşme: docs/ops/INDIRME-KAPISI-WORKER.md.

export const DOWNLOAD_TOKEN_HEADER = "X-TKL-Indirme";
export const DOWNLOAD_TOKEN_PATH = "/api/license/indirme-belirteci?urun=electron";
export const DOWNLOAD_TOKEN_TIMEOUT_MS = 5000;
/** Renderer'ın secure-store anahtarları (secure-token.ts · api-config.ts) — ayna testi ölçer. */
export const AUTH_TOKEN_STORE_KEY = "auth.token";
export const API_BASE_URL_STORE_KEY = "config.apiBaseUrl";

const JWS_PATTERN = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const MAX_TOKEN_LENGTH = 8192;

export interface DownloadTokenInput {
  /** Kayıtlı backend adresi (ör. `http://192.168.1.10:4000`); yoksa belirteç istenmez. */
  readonly apiBaseUrl: string | null;
  /** Oturum belirteci; yoksa belirteç istenmez (başlıksız denetim). */
  readonly authToken: string | null;
  readonly fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  readonly timeoutMs?: number;
}

/** Belirteç ucunun tam adresi — renderer'ın axios'u gibi taban + yol; http(s) değilse null. */
export function downloadTokenUrl(apiBaseUrl: string | null): string | null {
  const base = (apiBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(base)) return null;
  try {
    return new URL(`${base}${DOWNLOAD_TOKEN_PATH}`).toString();
  } catch {
    return null;
  }
}

/** Belirteci backend'den alır; her hata (yok · 4xx/5xx · zaman aşımı · biçimsiz) → null. Asla atmaz. */
export async function fetchDownloadToken(g: DownloadTokenInput): Promise<string | null> {
  const url = downloadTokenUrl(g.apiBaseUrl);
  if (!url || !g.authToken) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), g.timeoutMs ?? DOWNLOAD_TOKEN_TIMEOUT_MS);
  try {
    const res = await g.fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${g.authToken}`, accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { belirtec?: unknown } } | null;
    const token = body?.data?.belirtec;
    return typeof token === "string" && token.length <= MAX_TOKEN_LENGTH && JWS_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** electron-updater `setFeedURL` seçenekleri: belirteç varsa başlıkla, yoksa bugünkü gibi başlıksız. */
export function feedOptions(url: string, token: string | null): { provider: "generic"; url: string; requestHeaders?: Record<string, string> } {
  return token ? { provider: "generic", url, requestHeaders: { [DOWNLOAD_TOKEN_HEADER]: token } } : { provider: "generic", url };
}
