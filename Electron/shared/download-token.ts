// İNDİRME BELİRTECİ (3b) — panel her güncelleme denetiminden önce fabrikanın backend'inden kısa ömürlü
// belirteç alır ve electron-updater'a `X-TKL-Indirme` başlığı olarak verir (latest.yml + exe + blockmap;
// `applyFeed` — başlık `requestHeaders` özelliğinden gider, `setFeedURL` seçeneğinden DEĞİL).
// Belirteç alınamazsa denetim BAŞLIKSIZ yapılır (bugünkü davranış): Worker açılana dek sorunsuz, sonra
// geçiş listesi. Belirteç loglanmaz, diske yazılmaz, YALNIZ izinli güncelleme adresine gider
// (`isAllowedUpdateUrl`). Yanıtın `grup` alanı (O3) ortak paketin güncelleme grubudur: biçimsizse null, küme
// denetimi feed seçiminde (`groupFeedUrl`). `iptal` (I6a) güncel dağıtım iptali JWS'idir: imzası panelin ana
// sürecinde doğrulanır (`mergeReleaseRevocations`); biçimsizse null ve belirteci düşürmez. Sözleşme: docs/ops/INDIRME-KAPISI-WORKER.md.
import { isAllowedUpdateUrl } from "./update-feed";

export const DOWNLOAD_TOKEN_HEADER = "X-TKL-Indirme";
export const DOWNLOAD_TOKEN_PATH = "/api/license/indirme-belirteci?urun=electron";
export const DOWNLOAD_TOKEN_TIMEOUT_MS = 5000;
/** Renderer'ın secure-store anahtarları (secure-token.ts · api-config.ts) — ayna testi ölçer. */
export const AUTH_TOKEN_STORE_KEY = "auth.token";
export const API_BASE_URL_STORE_KEY = "config.apiBaseUrl";

const JWS_PATTERN = /^[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}$/;
const MAX_TOKEN_LENGTH = 8192;
/** Dağıtım iptali tavanı = panelin JWS tavanı (`kunye-jws.mjs` JWS_MAX_LENGTH, 32 KiB). */
const MAX_REVOCATION_LENGTH = 32 * 1024;
const GROUP_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Backend'in verdiği indirme izni: belirteç + (yalnız doğrulanmış kiradan) güncelleme grubu. */
export interface DownloadGrant {
  readonly belirtec: string;
  /** Kiranın güncelleme grubu; kira yok / grup değil / biçimsiz → null (ortak paket denetlemez). */
  readonly grup: string | null;
  /** Güncel dağıtım iptali (kök imzalı JWS); yok / biçimsiz → null. */
  readonly iptal: string | null;
}

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

/** Belirteci (+ grubu) backend'den alır; her hata (yok · 4xx/5xx · zaman aşımı · biçimsiz belirteç) → null. Asla atmaz. */
export async function fetchDownloadToken(g: DownloadTokenInput): Promise<DownloadGrant | null> {
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
    const body = (await res.json()) as { data?: { belirtec?: unknown; grup?: unknown; iptal?: unknown } } | null;
    const token = body?.data?.belirtec;
    if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !JWS_PATTERN.test(token)) return null;
    const grup = body?.data?.grup;
    const iptal = body?.data?.iptal;
    return {
      belirtec: token,
      grup: typeof grup === "string" && GROUP_PATTERN.test(grup) ? grup : null,
      iptal: typeof iptal === "string" && iptal.length <= MAX_REVOCATION_LENGTH && JWS_PATTERN.test(iptal) ? iptal : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * electron-updater `setFeedURL` seçenekleri — başlık TAŞIMAZ: `setFeedURL` seçeneklerdeki `requestHeaders`ı
 * yok sayar (6.x; yalnız kurucu okur), başlık `requestHeaders` ÖZELLİĞİnden gider (`applyFeed`).
 */
export function feedOptions(url: string): { provider: "generic"; url: string } {
  return { provider: "generic", url };
}

/** Belirteç başlığı YALNIZ izinli güncelleme adresine — ezilmiş ya da bozuk adres belirteci başka sunucuya taşıyamaz. */
export function feedHeaders(url: string, token: string | null): Record<string, string> | null {
  return token && isAllowedUpdateUrl(url) ? { [DOWNLOAD_TOKEN_HEADER]: token } : null;
}

/** electron-updater'ın feed yüzeyi (yalnız kullanılan iki üye; gerçek `AppUpdater` buna uyar). */
export interface FeedTarget {
  setFeedURL(options: { provider: "generic"; url: string }): void;
  requestHeaders: { [header: string]: unknown } | null;
}

/**
 * Feed'i ve belirteç başlığını BİRLİKTE uygular; belirteç yoksa önceki başlık temizlenir (bayat belirteç gitmez).
 * Başlık latest.yml + exe + blockmap isteklerine `AppUpdater.requestHeaders`tan eklenir.
 */
export function applyFeed(target: FeedTarget, url: string, token: string | null): void {
  target.setFeedURL(feedOptions(url));
  target.requestHeaders = feedHeaders(url, token);
}
