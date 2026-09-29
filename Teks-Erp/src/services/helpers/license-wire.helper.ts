// Lisans motorunun TEL katmanı: satıcıya imzalı istek, taşıma soyutlaması (test enjeksiyonu),
// hata sözlüğü (TR mesaj + `details.code`), önkoşullar ve ortam künyesi. Servisler bunu paylaşır.
import fs from "node:fs";
import os from "node:os";
import { AppError } from "../../utils/app-error";
import { APP_VERSION } from "../../lib/app-version";
import { EgressError, egressRequest } from "../../lib/http-egress";
import {
  REQUEST_HEADER,
  VendorErrorResponseSchema,
  VersionTextSchema,
  signRequest,
  type RequestPurpose,
  type VendorErrorCode,
} from "../../lib/license/protocol";
import { getLicenseStore, type InstallationKey, type LicenseStoreSnapshot } from "../../lib/license/store";
import { getLicenseConfig, getLicenseDbFacts, getMeasuredFingerprint } from "../../lib/license/runtime";

const VENDOR_TIMEOUT_MS = 20_000;

// ── Satıcı taşıması (test enjeksiyonu için soyut) ───────────────────────────────
export interface VendorHttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}
export interface VendorHttpResponse {
  readonly status: number;
  readonly body: string;
}
export type VendorTransport = (req: VendorHttpRequest) => Promise<VendorHttpResponse>;

export const egressTransport: VendorTransport = async (req) => {
  const res = await egressRequest(req.url, { method: req.method, headers: req.headers, body: req.body, timeoutMs: VENDOR_TIMEOUT_MS });
  return { status: res.status, body: res.body.toString("utf8") };
};

export type VendorResult =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly status: number; readonly code: string };

// ── Hatalar (TR mesaj + `details.code`) ─────────────────────────────────────────
export function licenseError(status: number, code: string, message: string, extra: Record<string, unknown> = {}): AppError {
  return new AppError(message, status, true, { code, ...extra });
}

// Satıcının HER koduna TR mesaj: yeni kod `VENDOR_ERROR_CODES`e eklenince burası derlenmez (tanınmayan kod
// sessizce "reddetti"ye düşmesin). Protokol doğrulama kodları (`JWS_*`, `ISTEK_*`) genel mesaja düşer.
const VENDOR_MESSAGES = {
  GOVDE_GECERSIZ: "Lisans sunucusu isteğin gövdesini kabul etmedi (sürüm uyumsuzluğu olabilir).",
  PROTOKOL_SURUMU: "Lisans sunucusu bu protokol sürümünü desteklemiyor.",
  ISTEK_GECERSIZ: "Lisans sunucusu imzalı isteği doğrulayamadı (saat farkı ya da anahtar sorunu olabilir).",
  ISTEK_TEKRAR: "Aynı istek ikinci kez gönderildi; biraz sonra tekrar deneyin.",
  ETKINLESTIRME_KODU_GECERSIZ: "Etkinleştirme kodu geçersiz.",
  ETKINLESTIRME_KODU_KULLANILMIS: "Bu etkinleştirme kodu daha önce kullanılmış.",
  TASIMA_ONAYI_BEKLIYOR: "Taşıma onayı bekleniyor; onaylanınca lisans kendiliğinden gelir.",
  TASIMA_KODU_GEREKLI: "Bu kurulum başka bir makinede etkin; taşıma talebi açın ve onaylanınca verilen taşıma koduyla etkinleştirin.",
  KURULUM_BILINMIYOR: "Bu kurulum lisans sunucusunda kayıtlı değil (taşıma talebi gerekebilir).",
  KURULUM_IPTAL: "Bu kurulumun lisansı taşındı ya da iptal edildi.",
  KIRA_VERILMEDI: "Lisans sunucusu bu kuruluma kira vermedi; destek hattıyla görüşün.",
  HIZ_SINIRI: "Çok sık denendi; biraz sonra tekrar deneyin.",
  TEKRAR_DENEYIN: "Lisans sunucusunda eşzamanlı bir işlem çakıştı; biraz sonra tekrar deneyin.",
  BULUNAMADI: "Lisans sunucusu bu isteği tanımadı (adres yanlış ya da sunucu sürümü eski olabilir; LICENSE_SERVER_URL ayarını kontrol edin).",
  SUNUCU_HATASI: "Lisans sunucusunda bir hata oluştu; biraz sonra tekrar deneyin.",
} as const satisfies Readonly<Record<VendorErrorCode, string>>;

/** Aynı istek sonradan tekrar denenebilir mi (panel "tekrar dene" gösterir; kalıcı red değil). */
const VENDOR_RETRYABLE: ReadonlySet<string> = new Set<VendorErrorCode>(["TEKRAR_DENEYIN", "HIZ_SINIRI", "ISTEK_TEKRAR", "SUNUCU_HATASI"]);

export function vendorFailureToError(r: { status: number; code: string }): AppError {
  if (r.status === 0) {
    return licenseError(502, "LICENSE_VENDOR_UNREACHABLE", "Lisans sunucusuna ulaşılamadı (internet ya da proxy ayarını kontrol edin).", {
      egressCode: r.code,
    });
  }
  const message = (VENDOR_MESSAGES as Readonly<Record<string, string>>)[r.code] ?? "Lisans sunucusu isteği reddetti.";
  return licenseError(409, "LICENSE_VENDOR_REJECTED", message, { vendorCode: r.code, tekrarDenenebilir: VENDOR_RETRYABLE.has(r.code) });
}

// ── Önkoşullar ──────────────────────────────────────────────────────────────────
export interface ReadyContext {
  readonly store: LicenseStoreSnapshot;
  readonly key: InstallationKey;
  readonly installationId: string;
}

export function requireStore(): LicenseStoreSnapshot & { key: InstallationKey } {
  const store = getLicenseStore();
  if (!store || store.problem || !store.key) {
    throw licenseError(409, "LICENSE_STORE_UNAVAILABLE", `Lisans deposu kullanılamıyor (${store?.problem ?? "yüklenmedi"}).`);
  }
  return { ...store, key: store.key };
}

export function requireReady(): ReadyContext {
  const store = requireStore();
  const installationId = getLicenseDbFacts().installationId;
  if (!installationId) throw licenseError(409, "LICENSE_IDENTITY_NOT_READY", "Kurulum kimliği henüz hazır değil; biraz sonra tekrar deneyin.");
  return { store, key: store.key, installationId };
}

export function requireVendorUrl(): string {
  const url = getLicenseConfig().vendorUrl;
  if (!url) throw licenseError(409, "LICENSE_NOT_CONFIGURED", "Lisans sunucusu adresi tanımlı değil (LICENSE_SERVER_URL).");
  return url;
}

// ── Satıcıya imzalı istek ───────────────────────────────────────────────────────
export function signedHeaders(ctx: ReadyContext, purpose: RequestPurpose, bodyText: string): Record<string, string> {
  const token = signRequest({ installationId: ctx.installationId, purpose, body: bodyText, key: { privateKey: ctx.key.privateKey, nowMs: Date.now() } });
  return { "content-type": "application/json", accept: "application/json", [REQUEST_HEADER]: token };
}

export async function vendorPost(path: string, purpose: RequestPurpose, body: unknown, transport: VendorTransport): Promise<VendorResult> {
  const ctx = requireReady();
  const base = requireVendorUrl();
  const text = JSON.stringify(body);
  let res: VendorHttpResponse;
  try {
    res = await transport({ url: `${base}${path}`, method: "POST", headers: signedHeaders(ctx, purpose, text), body: text });
  } catch (err) {
    return { ok: false, status: 0, code: err instanceof EgressError ? err.code : "EGRESS_NETWORK" };
  }
  let json: unknown = null;
  try {
    json = JSON.parse(res.body) as unknown;
  } catch {
    json = null;
  }
  if (res.status >= 200 && res.status < 300) return { ok: true, json };
  const err = VendorErrorResponseSchema.safeParse(json);
  return { ok: false, status: res.status, code: err.success ? err.data.details.code : `HTTP_${res.status}` };
}

// ── Ortam ve gövdeler ───────────────────────────────────────────────────────────
export function appVersionForWire(): string {
  return VersionTextSchema.safeParse(APP_VERSION).success ? APP_VERSION : "0.0.0";
}

export function buildEnvironment(): {
  platform: "win32" | "linux" | "darwin";
  mimari: "x64" | "arm64";
  isletimSistemi: string;
  nodeSurum: string;
  uygulamaSurum: string;
  derlemeTarihi: string | null;
  konteyner: boolean;
} {
  const platform = process.platform === "win32" || process.platform === "darwin" ? process.platform : "linux";
  return {
    platform,
    mimari: process.arch === "arm64" ? "arm64" : "x64",
    isletimSistemi: `${os.type()} ${os.release()}`.slice(0, 120),
    nodeSurum: /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(process.version) ? process.version : "v0.0.0",
    uygulamaSurum: appVersionForWire(),
    // İmzalı derleme künyesi Faz 2'de; imzasız tarih bakım kararına girmez.
    derlemeTarihi: null,
    konteyner: fs.existsSync("/.dockerenv") || fs.existsSync("/run/.containerenv"),
  };
}

export function currentFingerprintDigest(): { f1: string | null; f2: string | null; f3: string | null; f4: string | null; f5: string | null } {
  return getMeasuredFingerprint()?.digest ?? { f1: null, f2: null, f3: null, f4: null, f5: null };
}


export function invalidResponse(message: string, protocolCode?: string): AppError {
  return licenseError(400, "LICENSE_RESPONSE_INVALID", message, protocolCode ? { protocolCode } : {});
}
