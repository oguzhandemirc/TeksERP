// Lisans çekirdeği ARAYÜZÜ + TS uygulaması. İki uygulama var: native (`native.ts` yükler; Rust,
// `Teks-Erp/native/lisans-cekirdek`) ve bu dosyadaki TS. TS protokol (`protocol/`) TEK KAYNAKTIR ve
// test kâhini olarak kalır; native onun aynasıdır. Eşlik `test_lisans_native_kahin` ile ölçülür.
// Görünümler (view) yalnız VERİ taşır — anahtar nesnesi, imza baytı dışarı çıkmaz.
import {
  PROTOCOL_ERROR_CODES,
  publicKeyFromX,
  verifyCertificate,
  verifyEntitlement,
  verifyJws,
  verifyLease,
  verifyRevocation,
  checkLeaseBinding,
  pickNewerRevocation,
  isRevocationCurrent,
  offlineHorizonCeilingDays,
  normalizeFactor,
  digestFingerprint,
  compareFingerprints,
  assessIdentification,
  canAutoLearnFingerprint,
  success,
  type CertUsage,
  type CertificateDoc,
  type EntitlementDoc,
  type EntitlementSignerKind,
  type Fingerprint,
  type FingerprintDecision,
  type FingerprintFactor,
  type FingerprintRule,
  type IdentificationAssessment,
  type LeaseDoc,
  type LicenseClass,
  type ProtocolErrorCode,
  type RawFingerprint,
  type Result,
  type RevocationDoc,
  type RootKey,
  type VerifiedCertificate,
  type VerifiedEntitlement,
  type VerifiedLease,
  type VerifiedRevocation,
} from "./protocol";
import { collectOsOutcomes } from "./fingerprint-os";
import { collectedFrom, type OsReadings } from "./fingerprint-paths";
import { ROOT_PUBLIC_KEYS } from "./trust-anchor";
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
  readonly signer: { readonly kind: EntitlementSignerKind; readonly kid: string; readonly rootKid: string };
}

export interface LeaseView {
  readonly document: LeaseDoc;
  readonly subCertificate: CertificateView;
}

export interface RevocationView {
  readonly document: RevocationDoc;
  readonly rootKid: string;
}

/**
 * Lisans v2 zincir seçenekleri (G4). İptal belgesi JWS METNİ olarak verilir; çekirdek onu AYNI çapayla yeniden
 * doğrular (doğrulanmış görünüm girdisine güvenilmez). Doğrulanamayan iptal çağıranın hatasıdır: istek onun
 * koduyla düşer (fail-closed). `null`/yok = iptalsiz.
 */
export interface CoreChainOptions {
  readonly revocation?: unknown;
}

export interface CoreEntitlementOptions extends CoreChainOptions {
  /** Doğrulayanın "şimdi"si (duvar ∨ yüksek su); verilirse veriliş sınırı işler, sonlu değilse RED. */
  readonly nowMs?: number;
}

export interface FingerprintCompareOptions {
  readonly excludeF5?: boolean;
  /** Kiradaki `parmakIziKurali`; yoksa v1 kararı. */
  readonly rule?: FingerprintRule;
}

export interface CollectedFingerprint {
  readonly digest: Fingerprint;
  readonly measured: Readonly<Record<FingerprintFactor, boolean>>;
  /** f1..f4 çok yollu okuma raporu (K8): durum · kazanan yol · çelişen ve hata veren yollar — değer YOK. */
  readonly okuma: OsReadings;
}

/**
 * `roots`/`keys` verilmezse GÖMÜLÜ çapa kullanılır (üretim yolu). Verilirse: TS her zaman kabul
 * eder; native yalnız test çapalı derlemede (`CAPA_ENJEKSIYONU_KAPALI` — yamalı JS kendi kökünü
 * geçiremesin).
 */
export interface LicenseCore {
  readonly source: "native" | "ts" | "yok";
  verifyJws(token: unknown, typ: string, keys: readonly JwsKey[]): CoreResult<JwsView>;
  verifyCertificate(
    token: unknown,
    g: { readonly usage: CertUsage; readonly atMs: number; readonly roots?: readonly RootKey[]; readonly revocation?: unknown },
  ): CoreResult<CertificateView>;
  verifyEntitlement(token: unknown, roots?: readonly RootKey[], options?: CoreEntitlementOptions): CoreResult<EntitlementView>;
  verifyLease(token: unknown, roots?: readonly RootKey[], options?: CoreChainOptions): CoreResult<LeaseView>;
  /** İki belgeyi DOĞRULAR ve bağlar (doğrulanmış görünüm girdisine güvenilmez); kiranın `hakOzeti` bayt bağı dahil. */
  checkLeaseBinding(leaseJws: unknown, entitlementJws: unknown, roots?: readonly RootKey[]): CoreResult<true>;
  /** İPTAL belgesi (G4 §2.3): yalnız çapadaki bir kök imzalar. */
  verifyRevocation(token: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView>;
  /** İkisi de doğrulanır; yüksek `sira` kazanır, eşit/düşük gelen yok sayılır. `null`/yok = belge yok; ikisi de yoksa `null`. */
  pickNewerRevocation(current: unknown, incoming: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView | null>;
  /** Kira (önce) ve iptal doğrulanır; kiranın beyan ettiği `iptalSira`ya eldeki belge yetişiyor mu. */
  isRevocationCurrent(leaseJws: unknown, revocation: unknown, roots?: readonly RootKey[]): CoreResult<boolean>;
  /** Parmak izi kararı (K8): kural yoksa v1, `standart` (kayıp = uyuşmazlık, güçlü ≥ 2), `zayif`. */
  compareFingerprints(accepted: Fingerprint, measured: Fingerprint, options?: FingerprintCompareOptions): FingerprintDecision;
  assessIdentification(fingerprint: Fingerprint, options?: { readonly excludeF5?: boolean }): IdentificationAssessment;
  canAutoLearnFingerprint(accepted: Fingerprint, measured: Fingerprint, options?: { readonly excludeF5?: boolean }): boolean;
  /** Sınıf ve imzacıya göre çevrimdışı ufuk tavanı (gün; `null` = tavansız). */
  offlineHorizonCeilingDays(sinif: LicenseClass, signer: EntitlementSignerKind): number | null;
  normalizeFactor(factor: FingerprintFactor, raw: string | null | undefined): string | null;
  /** Tuz 16 bayttan kısaysa fırlatır (programcı hatası; TS protokolüyle aynı). */
  digestFingerprint(raw: RawFingerprint, salt: Uint8Array): Fingerprint;
  /** OS etkenleri (f1..f4, çok yollu) + çağıranın F5'i → yalnız tuzlu özet ve okuma raporu. */
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

function revocationView(r: VerifiedRevocation): RevocationView {
  return { document: r.document, rootKid: r.rootKid };
}

/** İsteğe bağlı iptal metni → doğrulanmış belge (`null` = iptalsiz); TS ve native aynı sırayla doğrular. */
function revocationOf(token: unknown, roots: readonly RootKey[]): Result<VerifiedRevocation | null> {
  return token === undefined || token === null ? success(null) : verifyRevocation(token, roots);
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
  verifyCertificate(token: unknown, g: { usage: CertUsage; atMs: number; roots?: readonly RootKey[]; revocation?: unknown }): CoreResult<CertificateView> {
    const anchor = g.roots ?? ROOT_PUBLIC_KEYS;
    const r = revocationOf(g.revocation, anchor);
    if (!r.ok) return r;
    const c = verifyCertificate(token, { roots: anchor, usage: g.usage, atMs: g.atMs, revocation: r.value });
    return c.ok ? { ok: true, value: certificateView(c.value) } : c;
  },
  verifyEntitlement(token: unknown, roots?: readonly RootKey[], options: CoreEntitlementOptions = {}): CoreResult<EntitlementView> {
    const anchor = roots ?? ROOT_PUBLIC_KEYS;
    const r = revocationOf(options.revocation, anchor);
    if (!r.ok) return r;
    const h = verifyEntitlement(token, anchor, { revocation: r.value, ...(options.nowMs !== undefined ? { nowMs: options.nowMs } : {}) });
    return h.ok ? { ok: true, value: entitlementView(h.value) } : h;
  },
  verifyLease(token: unknown, roots?: readonly RootKey[], options: CoreChainOptions = {}): CoreResult<LeaseView> {
    const anchor = roots ?? ROOT_PUBLIC_KEYS;
    const r = revocationOf(options.revocation, anchor);
    if (!r.ok) return r;
    const k = verifyLease(token, anchor, { revocation: r.value });
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
  verifyRevocation(token: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView> {
    const r = verifyRevocation(token, roots ?? ROOT_PUBLIC_KEYS);
    return r.ok ? { ok: true, value: revocationView(r.value) } : r;
  },
  pickNewerRevocation(current: unknown, incoming: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView | null> {
    const anchor = roots ?? ROOT_PUBLIC_KEYS;
    const c = revocationOf(current, anchor);
    if (!c.ok) return c;
    const i = revocationOf(incoming, anchor);
    if (!i.ok) return i;
    const picked = pickNewerRevocation(c.value, i.value);
    return { ok: true, value: picked ? revocationView(picked) : null };
  },
  isRevocationCurrent(leaseJws: unknown, revocation: unknown, roots?: readonly RootKey[]): CoreResult<boolean> {
    const anchor = roots ?? ROOT_PUBLIC_KEYS;
    const k = verifyLease(leaseJws, anchor);
    if (!k.ok) return k;
    const r = revocationOf(revocation, anchor);
    if (!r.ok) return r;
    return { ok: true, value: isRevocationCurrent(k.value.document, r.value) };
  },
  compareFingerprints(accepted: Fingerprint, measured: Fingerprint, options: FingerprintCompareOptions = {}): FingerprintDecision {
    return compareFingerprints(accepted, measured, options);
  },
  assessIdentification(fingerprint: Fingerprint, options: { excludeF5?: boolean } = {}): IdentificationAssessment {
    return assessIdentification(fingerprint, options);
  },
  canAutoLearnFingerprint(accepted: Fingerprint, measured: Fingerprint, options: { excludeF5?: boolean } = {}): boolean {
    return canAutoLearnFingerprint(accepted, measured, options);
  },
  offlineHorizonCeilingDays(sinif: LicenseClass, signer: EntitlementSignerKind): number | null {
    return offlineHorizonCeilingDays(sinif, signer);
  },
  normalizeFactor(factor: FingerprintFactor, raw: string | null | undefined): string | null {
    return normalizeFactor(factor, raw);
  },
  digestFingerprint(raw: RawFingerprint, salt: Uint8Array): Fingerprint {
    return digestFingerprint(raw, salt);
  },
  async collectFingerprint(salt: Uint8Array, f5: string | null): Promise<CollectedFingerprint> {
    const os = await collectOsOutcomes();
    return collectedFrom(os.platform, os.outcomes, salt, f5);
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
