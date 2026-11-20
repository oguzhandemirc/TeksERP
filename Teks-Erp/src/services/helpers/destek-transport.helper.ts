// =============================================================================
// DESTEK MERKEZİ — yapılandırma, çıkış (egress) ve hata eşlemesi
// =============================================================================
// Kapatma düğmesi `.env`tir: `DESTEK_API_URL` ve `DESTEK_API_KEY` ikisi de dolu ve
// adres izinli (HTTPS; düz HTTP yalnız döngü adresi) değilse özellik KAPALIDIR ve
// hiçbir dış istek yapılmaz. Lisans HAK'ında tesis kimliği yoksa (lisanssız kurulum) da
// KAPALIDIR. Ortam her çağrıda okunur (önbellek yok): açılışta istek yok.
//
// Hazır istemci (`integrations/destek`) `fetch` ister; isteği fabrikanın tek dış
// çıkışından (`lib/http-egress.ts`) geçiren küçük bir uyarlayıcı verilir:
// kurumsal proxy ortamdan gelir, düz HTTP dışarı çıkamaz, yanıt boyu tavanlıdır.
//
// Anahtar HİÇBİR çıktıya girmez: log satırları yalnız merkez kodu + HTTP durumu
// taşır, hata gövdesine merkezin kendi Türkçe mesajı ya da sabit metin yazılır.
// =============================================================================

import { DestekApiError, DestekClient } from "../../integrations/destek";
import { EgressError, egressRequest, isEgressTargetAllowed } from "../../lib/http-egress";
import { getLicenseSnapshot } from "../../lib/license/runtime";
import { uyari } from "../../lib/logger";
import { AppError } from "../../utils/app-error";

export interface SupportDeskConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly tenantId: string;
}

/** İstek zaman aşımları (ms): normal, ekli yükleme, menü rozeti. */
export const SUPPORT_TIMEOUT_MS = 15_000;
export const SUPPORT_UPLOAD_TIMEOUT_MS = 60_000;
export const SUPPORT_BADGE_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

let warnedInvalidUrl = false;

function isAllowedUrl(s: string): boolean {
  try {
    return isEgressTargetAllowed(new URL(s));
  } catch {
    return false;
  }
}

let tenantIdOverride: string | null | undefined;

/** Bekçi kancası: lisans HAK'ı olmadan tesis kimliğini sabitler (`undefined` = gerçek kaynağa dön). */
export function setSupportTenantIdForTests(value: string | null | undefined): void {
  tenantIdOverride = value;
}

/**
 * Firma kimliği = lisans HAK'ındaki `tesis.id`, küçük harf (patron bulutu `supportTenantId` ile aynı).
 * Lisanssız/okunamayan kurulumda `null` → özellik KAPALI (FAIL-CLOSED; uydurma kimlik yok).
 */
export function readSupportTenantId(): string | null {
  const raw = tenantIdOverride !== undefined ? tenantIdOverride : licenseFacilityId();
  return raw ? raw.toLowerCase() : null;
}

function licenseFacilityId(): string | null {
  try {
    return getLicenseSnapshot().entitlement?.document.tesis.id ?? null;
  } catch {
    return null;
  }
}

/** Etkin yapılandırma ya da `null` (= özellik kapalı: env eksik/geçersiz ya da lisans tesis kimliği yok). Dış istek yapmaz. */
export function readSupportDeskConfig(env: NodeJS.ProcessEnv = process.env): SupportDeskConfig | null {
  const baseUrl = env.DESTEK_API_URL?.trim() ?? "";
  const apiKey = env.DESTEK_API_KEY?.trim() ?? "";
  if (!baseUrl || !apiKey) return null;
  const tenantId = readSupportTenantId();
  if (!tenantId) return null;
  if (!isAllowedUrl(baseUrl)) {
    if (!warnedInvalidUrl) {
      warnedInvalidUrl = true;
      uyari("destek", "DESTEK_API_URL geçersiz ya da HTTPS değil; destek özelliği KAPALI sayıldı");
    }
    return null;
  }
  return { baseUrl, apiKey, tenantId };
}

function toWebHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    h.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  return h;
}

async function bodyBytes(url: string, method: string, init: RequestInit, headers: Record<string, string>): Promise<Buffer | undefined> {
  const body = init.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  // FormData → multipart baytları; sınır (boundary) içeren content-type da buradan gelir.
  const r = new Request(url, { method, body });
  const ct = r.headers.get("content-type");
  if (ct && !headers["content-type"]) headers["content-type"] = ct;
  return Buffer.from(await r.arrayBuffer());
}

/** `fetch` biçiminde, `http-egress` üstünden çalışan çıkış. Zaman aşımı TimeoutError olarak döner. */
export function egressFetch(timeoutMs: number): typeof fetch {
  const impl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") throw new TypeError("Desteklenmeyen yöntem");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const body = await bodyBytes(url, method, init, headers);
    try {
      const res = await egressRequest(url, { method, headers, body, timeoutMs, maxBytes: MAX_RESPONSE_BYTES });
      const empty = res.status === 204 || res.status === 205 || res.status === 304;
      return new Response(empty ? null : new Uint8Array(res.body), { status: res.status, headers: toWebHeaders(res.headers) });
    } catch (e) {
      if (e instanceof EgressError && e.code === "EGRESS_TIMEOUT") throw new DOMException(e.message, "TimeoutError");
      throw new TypeError(e instanceof Error ? e.message : "Dış bağlantı kurulamadı");
    }
  };
  return impl;
}

export function createSupportClient(cfg: SupportDeskConfig, timeoutMs: number): DestekClient {
  return new DestekClient({
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    timeoutMs,
    uploadTimeoutMs: timeoutMs,
    fetch: egressFetch(timeoutMs),
  });
}

/** Ek içeriği tavanı: dosya sınırı 10 MB + pay (merkezin dönüştürdüğü görsel biraz büyüyebilir). */
export const SUPPORT_MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024 + 512 * 1024;

/**
 * SSRF kapısı: indirme adresi merkezin KENDİ kökeninde (şema + host + port) olmalı ve
 * çıkış kuralına uymalı. Başka hosta istek atılmaz.
 */
export function isSupportDownloadUrl(cfg: SupportDeskConfig, raw: string): URL | null {
  let u: URL;
  let base: URL;
  try {
    u = new URL(raw);
    base = new URL(cfg.baseUrl);
  } catch {
    return null;
  }
  if (u.origin !== base.origin || u.username || u.password) return null;
  return isEgressTargetAllowed(u) ? u : null;
}

export interface SupportDownload {
  readonly status: number;
  readonly contentType: string;
  readonly body: Buffer;
}

/**
 * Merkezin verdiği süreli bağlantıdan ek baytlarını indirir. Bağlantı kendi belirtecini
 * taşır: anahtar/imza başlığı GÖNDERİLMEZ. Yönlendirme izlenmez (3xx çağırana döner).
 */
export async function downloadSupportFile(url: URL, timeoutMs: number): Promise<SupportDownload> {
  try {
    const res = await egressRequest(url.toString(), { method: "GET", timeoutMs, maxBytes: SUPPORT_MAX_DOWNLOAD_BYTES });
    const ct = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    return { status: res.status, contentType: ct, body: res.body };
  } catch (e) {
    const code = e instanceof EgressError ? e.code : "EGRESS_NETWORK";
    uyari("destek", `ek indirilemedi: ${code}`);
    if (code === "EGRESS_TIMEOUT") throw new AppError(UNREACHABLE, 504, true, { code: "DESTEK_ZAMAN_ASIMI", merkezKodu: "TIMEOUT" });
    throw new AppError(UNREACHABLE, 502, true, { code: "DESTEK_ULASILAMADI", merkezKodu: code });
  }
}

const UNREACHABLE = "Destek merkezine ulaşılamadı, lütfen biraz sonra tekrar deneyin.";
const MISCONFIGURED = "Destek bağlantısı şu an kullanılamıyor (sunucu yapılandırması). Sistem yöneticinize bildirin.";
/** Merkezin kimlik/imza reddi: istemciye 401 olarak GİTMEZ (panel 401'de oturumu kapatır). */
const CONFIG_CODES = new Set(["INVALID_API_KEY", "INVALID_SIGNATURE", "TIMESTAMP_OUT_OF_RANGE", "INSTALLATION_INACTIVE"]);

/**
 * Merkez hatasını repo hata sözleşmesine çevirir (`details.code`). Bilinmeyen hata
 * aynen fırlatılır (genel 500 yolu). Anahtar hiçbir dalda mesaja girmez.
 */
export function mapSupportError(e: unknown): unknown {
  if (!(e instanceof DestekApiError)) return e;
  const center = { merkezKodu: e.code };
  if (e.status === 0) {
    uyari("destek", `merkez isteği düştü: ${e.code}`);
    return e.code === "TIMEOUT"
      ? new AppError(UNREACHABLE, 504, true, { code: "DESTEK_ZAMAN_ASIMI", ...center })
      : new AppError(UNREACHABLE, 502, true, { code: "DESTEK_ULASILAMADI", ...center });
  }
  if (e.status === 429) {
    return AppError.tooManyRequests("Destek merkezine çok sık istek gönderildi; biraz bekleyip tekrar deneyin.", {
      code: "RATE_LIMITED",
      retryAfterSec: e.retryAfterSeconds ?? 30,
    });
  }
  if (e.status >= 500 || e.code === "REPLAYED") {
    uyari("destek", `merkez hatası: ${e.code} (HTTP ${e.status})`);
    return new AppError(UNREACHABLE, 502, true, { code: "DESTEK_ULASILAMADI", ...center });
  }
  if (e.status === 401 || CONFIG_CODES.has(e.code)) {
    uyari("destek", `merkez bağlantıyı reddetti: ${e.code} (HTTP ${e.status})`);
    return new AppError(MISCONFIGURED, 502, true, { code: "DESTEK_YAPILANDIRMA", ...center });
  }
  return new AppError(e.message, e.status, true, { code: e.code });
}
