// Lisans çekirdeği ARAYÜZÜ + TS uygulaması. İki uygulama var: native (`native.ts` yükler; Rust,
// `Teks-Erp/native/lisans-cekirdek`) ve bu dosyadaki TS. TS protokol (`protocol/`) TEK KAYNAKTIR ve
// test kâhini olarak kalır; native onun aynasıdır. Eşlik `test_lisans_native_kahin` ile ölçülür.
// Görünümler (view) yalnız VERİ taşır — anahtar nesnesi, imza baytı dışarı çıkmaz.
import {
  ROOT_PUBLIC_KEYS,
  PROTOCOL_ERROR_CODES,
  publicKeyFromX,
  verifyCertificate,
  verifyEntitlement,
  verifyJws,
  verifyLease,
  checkLeaseBinding,
  normalizeFactor,
  digestFingerprint,
  FINGERPRINT_FACTORS,
  type CertUsage,
  type CertificateDoc,
  type EntitlementDoc,
  type Fingerprint,
  type FingerprintFactor,
  type LeaseDoc,
  type LicenseClass,
  type ProtocolErrorCode,
  type RawFingerprint,
  type RootKey,
  type VerifiedCertificate,
  type VerifiedEntitlement,
  type VerifiedLease,
} from "./protocol";
import { collectOsFactors } from "./fingerprint-os";
import { verifyIntegrity, type IntegrityReport, type PackageKey } from "./integrity";
import {
  unwrapModuleKey,
  unwrapLeaseModuleKey,
  LEASE_MODULE_KEY_ERROR_CODES,
  MODULE_KEY_ERROR_CODES,
  type LeaseModuleKeyRequest,
} from "./module-key";
import type { KeyObject } from "node:crypto";

/** Çekirdeğe özgü kodlar (protokol kümesinde yok). Native aynası `outcome.rs` `code::CORE`. */
export const CORE_ERROR_CODES = [
  "CAPA_ENJEKSIYONU_KAPALI",
  "BUTUNLUK_CAPA_BOS",
  "BUTUNLUK_OKUNAMADI",
  "BUTUNLUK_UYUSMAZ",
  "BUTUNLUK_FAZLA",
  "BUTUNLUK_LISTE_BOZUK",
  ...MODULE_KEY_ERROR_CODES,
  ...LEASE_MODULE_KEY_ERROR_CODES,
  // Yerel koruma (Windows DPAPI) — modül anahtarı önbelleği.
  "KORUMA_YOK",
  "KORUMA_HATASI",
] as const;
/** Zorunlu kipte native kullanılamıyorsa her doğrulama bu kodla düşer (TS'e düşülmez). */
export const CORE_UNAVAILABLE_CODE = "CEKIRDEK_YOK";
export type CoreErrorCode = ProtocolErrorCode | (typeof CORE_ERROR_CODES)[number] | typeof CORE_UNAVAILABLE_CODE;
export const ALL_CORE_RESULT_CODES: readonly CoreErrorCode[] = Object.freeze([
  ...PROTOCOL_ERROR_CODES,
  ...CORE_ERROR_CODES,
  CORE_UNAVAILABLE_CODE,
]);

export type CoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: CoreErrorCode; readonly message: string };

export interface JwsKey {
  readonly kid: string;
  /** Ham 32 baytlık Ed25519 açık anahtarı, base64url. */
  readonly x: string;
}

export interface JwsView {
  readonly header: { readonly alg: "EdDSA"; readonly typ: string; readonly kid: string };
  readonly payload: Record<string, unknown>;
}

export interface CertificateView {
  readonly document: CertificateDoc;
  readonly rootKid: string;
  readonly allowedClasses: readonly LicenseClass[];
}

export interface EntitlementView {
  readonly document: EntitlementDoc;
  readonly signer: { readonly kind: "KOK" | "BAYI"; readonly kid: string; readonly rootKid: string };
}

export interface LeaseView {
  readonly document: LeaseDoc;
  readonly subCertificate: CertificateView;
}

export interface CollectedFingerprint {
  readonly digest: Fingerprint;
  readonly measured: Readonly<Record<FingerprintFactor, boolean>>;
}

/**
 * `roots`/`keys` verilmezse GÖMÜLÜ çapa kullanılır (üretim yolu). Verilirse: TS her zaman kabul
 * eder; native yalnız test çapalı derlemede (`CAPA_ENJEKSIYONU_KAPALI` — yamalı JS kendi kökünü
 * geçiremesin).
 */
export interface LicenseCore {
  readonly source: "native" | "ts" | "yok";
  verifyJws(token: unknown, typ: string, keys: readonly JwsKey[]): CoreResult<JwsView>;
  verifyCertificate(token: unknown, g: { readonly usage: CertUsage; readonly atMs: number; readonly roots?: readonly RootKey[] }): CoreResult<CertificateView>;
  verifyEntitlement(token: unknown, roots?: readonly RootKey[]): CoreResult<EntitlementView>;
  verifyLease(token: unknown, roots?: readonly RootKey[]): CoreResult<LeaseView>;
  /** İki belgeyi DOĞRULAR ve bağlar (doğrulanmış görünüm girdisine güvenilmez). */
  checkLeaseBinding(leaseJws: unknown, entitlementJws: unknown, roots?: readonly RootKey[]): CoreResult<true>;
  normalizeFactor(factor: FingerprintFactor, raw: string | null | undefined): string | null;
  /** Tuz 16 bayttan kısaysa fırlatır (programcı hatası; TS protokolüyle aynı). */
  digestFingerprint(raw: RawFingerprint, salt: Uint8Array): Fingerprint;
  /** OS etkenleri (f1..f4) + çağıranın F5'i → yalnız tuzlu özet. */
  collectFingerprint(salt: Uint8Array, f5: string | null): Promise<CollectedFingerprint>;
  verifyIntegrity(manifest: unknown, root: string, keys?: readonly PackageKey[]): Promise<CoreResult<IntegrityReport>>;
  unwrapModuleKey(wrap: unknown, privateKeyX: string, modul: string): CoreResult<{ readonly anahtar: string }>;
  /** Faz 2d: anahtar YALNIZ doğrulanmış kira + HAK'tan (bağlı, modül HAK'ta, dondurulmamış, kid eşit). */
  unwrapLeaseModuleKey(g: LeaseModuleKeyRequest): CoreResult<{ readonly anahtar: string; readonly surum: number }>;
  /** Yerel sarma (Windows DPAPI); başka platformda `KORUMA_YOK`. Veri base64url. */
  protectLocal(veri: string): CoreResult<{ readonly veri: string }>;
  unprotectLocal(veri: string): CoreResult<{ readonly veri: string }>;
}

export function certificateView(c: VerifiedCertificate): CertificateView {
  return { document: c.document, rootKid: c.rootKid, allowedClasses: [...c.allowedClasses] };
}

function entitlementView(h: VerifiedEntitlement): EntitlementView {
  return { document: h.document, signer: { ...h.signer } };
}

function leaseView(k: VerifiedLease): LeaseView {
  return { document: k.document, subCertificate: certificateView(k.subCertificate) };
}

function measuredOf(digest: Fingerprint): Record<FingerprintFactor, boolean> {
  const out: Record<FingerprintFactor, boolean> = { f1: false, f2: false, f3: false, f4: false, f5: false };
  for (const f of FINGERPRINT_FACTORS) out[f] = digest[f] !== null;
  return out;
}

const NO_LOCAL_PROTECTION = Object.freeze({ ok: false, code: "KORUMA_YOK", message: "Yerel koruma yalnız native çekirdekte (Windows DPAPI)" } as const);

/** TS uygulaması — protokolün kendisi; geliştirme/test yolu ve native'in kâhini. */
export const tsLicenseCore: LicenseCore = Object.freeze({
  source: "ts" as const,
  verifyJws(token: unknown, typ: string, keys: readonly JwsKey[]): CoreResult<JwsView> {
    // Aynı kid iki kez verilirse İLK girdi kazanır (biçimsiz olsa bile) — native ile aynı.
    const lookup = new Map<string, KeyObject | null>();
    for (const k of keys) if (!lookup.has(k.kid)) lookup.set(k.kid, publicKeyFromX(k.x));
    const j = verifyJws(token, { typ, findKey: (kid) => lookup.get(kid) ?? undefined });
    if (!j.ok) return j;
    return { ok: true, value: { header: { ...j.value.header }, payload: j.value.payload } };
  },
  verifyCertificate(token: unknown, g: { usage: CertUsage; atMs: number; roots?: readonly RootKey[] }): CoreResult<CertificateView> {
    const c = verifyCertificate(token, { roots: g.roots ?? ROOT_PUBLIC_KEYS, usage: g.usage, atMs: g.atMs });
    return c.ok ? { ok: true, value: certificateView(c.value) } : c;
  },
  verifyEntitlement(token: unknown, roots?: readonly RootKey[]): CoreResult<EntitlementView> {
    const h = verifyEntitlement(token, roots ?? ROOT_PUBLIC_KEYS);
    return h.ok ? { ok: true, value: entitlementView(h.value) } : h;
  },
  verifyLease(token: unknown, roots?: readonly RootKey[]): CoreResult<LeaseView> {
    const k = verifyLease(token, roots ?? ROOT_PUBLIC_KEYS);
    return k.ok ? { ok: true, value: leaseView(k.value) } : k;
  },
  checkLeaseBinding(leaseJws: unknown, entitlementJws: unknown, roots?: readonly RootKey[]): CoreResult<true> {
    const anchor = roots ?? ROOT_PUBLIC_KEYS;
    const k = verifyLease(leaseJws, anchor);
    if (!k.ok) return k;
    const h = verifyEntitlement(entitlementJws, anchor);
    if (!h.ok) return h;
    return checkLeaseBinding(k.value, h.value);
  },
  normalizeFactor(factor: FingerprintFactor, raw: string | null | undefined): string | null {
    return normalizeFactor(factor, raw);
  },
  digestFingerprint(raw: RawFingerprint, salt: Uint8Array): Fingerprint {
    return digestFingerprint(raw, salt);
  },
  async collectFingerprint(salt: Uint8Array, f5: string | null): Promise<CollectedFingerprint> {
    const digest = digestFingerprint({ ...(await collectOsFactors()), f5 }, salt);
    return { digest, measured: measuredOf(digest) };
  },
  async verifyIntegrity(manifest: unknown, root: string, keys?: readonly PackageKey[]): Promise<CoreResult<IntegrityReport>> {
    return { ok: true, value: await verifyIntegrity(manifest, root, keys) };
  },
  unwrapModuleKey(wrap: unknown, privateKeyX: string, modul: string): CoreResult<{ anahtar: string }> {
    return unwrapModuleKey(wrap, privateKeyX, modul);
  },
  unwrapLeaseModuleKey(g: LeaseModuleKeyRequest): CoreResult<{ anahtar: string; surum: number }> {
    return unwrapLeaseModuleKey(g);
  },
  // TS'te yerel koruma yok (DPAPI native'dedir): önbellek dosya iznine düşer ya da hiç tutulmaz.
  protectLocal: (): CoreResult<{ veri: string }> => NO_LOCAL_PROTECTION,
  unprotectLocal: (): CoreResult<{ veri: string }> => NO_LOCAL_PROTECTION,
});
