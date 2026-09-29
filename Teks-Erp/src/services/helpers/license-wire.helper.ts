// Lisans motorunun TEL katmanı: satıcıya imzalı istek, taşıma soyutlaması (test enjeksiyonu),
// hata sözlüğü (TR mesaj + `details.code`), önkoşullar ve ortam künyesi. Servisler bunu paylaşır.
import fs from "node:fs";
import os from "node:os";
import { AppError } from "../../utils/app-error";
import { APP_VERSION } from "../../lib/app-version";
import { EgressError, egressRequest } from "../../lib/http-egress";
import { REQUEST_HEADER, VendorErrorResponseSchema, VersionTextSchema, signRequest, type RequestPurpose } from "../../lib/license/protocol";
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

const VENDOR_MESSAGES: Readonly<Record<string, string>> = {
  ETKINLESTIRME_KODU_GECERSIZ: "Etkinleştirme kodu geçersiz.",
  ETKINLESTIRME_KODU_KULLANILMIS: "Bu etkinleştirme kodu daha önce kullanılmış.",
  TASIMA_ONAYI_BEKLIYOR: "Taşıma onayı bekleniyor; onaylanınca lisans kendiliğinden gelir.",
  KURULUM_BILINMIYOR: "Bu kurulum lisans sunucusunda kayıtlı değil (taşıma talebi gerekebilir).",
  KURULUM_IPTAL: "Bu kurulumun lisansı taşındı ya da iptal edildi.",
  KIRA_VERILMEDI: "Lisans sunucusu bu kuruluma kira vermedi; destek hattıyla görüşün.",
  HIZ_SINIRI: "Çok sık denendi; biraz sonra tekrar deneyin.",
};

export function vendorFailureToError(r: { status: number; code: string }): AppError {
  if (r.status === 0) {
    return licenseError(502, "LICENSE_VENDOR_UNREACHABLE", "Lisans sunucusuna ulaşılamadı (internet ya da proxy ayarını kontrol edin).", {
      egressCode: r.code,
    });
  }
  return licenseError(409, "LICENSE_VENDOR_REJECTED", VENDOR_MESSAGES[r.code] ?? "Lisans sunucusu isteği reddetti.", { vendorCode: r.code });
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
