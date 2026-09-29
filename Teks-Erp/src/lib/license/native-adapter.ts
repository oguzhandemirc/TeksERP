// Native lisans çekirdeğinin ADAPTÖRÜ: napi ihraçlarının şekli, native yanıtlarının sözleşme şemaları,
// native çekirdek ve zorunlu kipte kullanılamayan "yok" çekirdeği. Yükleyici `native.ts`tedir.
// Native yanıtı sözleşme şemalarından geçirilir: native'deki bir hata sessiz kabul üretemez.
import { z } from "zod";
import {
  CertificateSchema,
  EntitlementSchema,
  FingerprintSchema,
  LeaseSchema,
  LICENSE_CLASSES,
  b64uEncode,
  isPlainObject,
  type CertUsage,
  type Fingerprint,
  type FingerprintFactor,
  type RawFingerprint,
  type RootKey,
} from "./protocol";
import {
  ALL_CORE_RESULT_CODES,
  CORE_UNAVAILABLE_CODE,
  type CertificateView,
  type CollectedFingerprint,
  type CoreResult,
  type EntitlementView,
  type JwsKey,
  type JwsView,
  type LeaseView,
  type LicenseCore,
} from "./license-core";
import { IntegrityReportSchema, type IntegrityReport, type PackageKey } from "./integrity";

export interface NativeBinding {
  kunye(): string;
  builtinAnchor(): string;
  verifyJws(request: string): string;
  verifyCertificate(request: string): string;
  verifyEntitlement(request: string): string;
  verifyLease(request: string): string;
  checkLeaseBinding(request: string): string;
  normalizeFactor(request: string): string;
  digestFingerprint(request: string): string;
  unwrapModuleKey(request: string): string;
  collectFingerprint(request: string): Promise<string>;
  verifyIntegrity(request: string): Promise<string>;
}

const BINDING_FUNCTIONS = [
  "kunye",
  "builtinAnchor",
  "verifyJws",
  "verifyCertificate",
  "verifyEntitlement",
  "verifyLease",
  "checkLeaseBinding",
  "normalizeFactor",
  "digestFingerprint",
  "unwrapModuleKey",
  "collectFingerprint",
  "verifyIntegrity",
] as const;

export function isNativeBinding(x: unknown): x is NativeBinding {
  if (typeof x !== "object" || x === null) return false;
  return BINDING_FUNCTIONS.every((name) => typeof Reflect.get(x, name) === "function");
}

// ── Native yanıtlarının sözleşme şemaları ─────────────────────────────────────
const CodeSchema = z.enum(ALL_CORE_RESULT_CODES);
function resultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), code: CodeSchema, message: z.string() }),
  ]);
}
const JwsViewSchema = z.object({
  header: z.object({ alg: z.literal("EdDSA"), typ: z.string(), kid: z.string() }),
  // `z.record` yeni nesne kurar ve `__proto__` anahtarını prototipe yazar (yükten düşer); yük AYNEN geçer.
  payload: z.custom<Record<string, unknown>>(isPlainObject),
});
const CertificateViewSchema = z.object({ document: CertificateSchema, rootKid: z.string(), allowedClasses: z.array(z.enum(LICENSE_CLASSES)) });
const EntitlementViewSchema = z.object({
  document: EntitlementSchema,
  signer: z.object({ kind: z.enum(["KOK", "BAYI"]), kid: z.string(), rootKid: z.string() }),
});
const LeaseViewSchema = z.object({ document: LeaseSchema, subCertificate: CertificateViewSchema });
const CollectedSchema = z.object({
  digest: FingerprintSchema,
  measured: z.object({ f1: z.boolean(), f2: z.boolean(), f3: z.boolean(), f4: z.boolean(), f5: z.boolean() }),
});

const EMPTY_FINGERPRINT: Fingerprint = Object.freeze({ f1: null, f2: null, f3: null, f4: null, f5: null });
const UNMEASURED: CollectedFingerprint = Object.freeze({
  digest: EMPTY_FINGERPRINT,
  measured: Object.freeze({ f1: false, f2: false, f3: false, f4: false, f5: false }),
});

function contractBreach<T>(what: string): CoreResult<T> {
  return { ok: false, code: CORE_UNAVAILABLE_CODE, message: `Lisans çekirdeğinin ${what} yanıtı sözleşmeye uymuyor` };
}

function decodeResult<T>(schema: z.ZodType<CoreResult<T>>, text: string, what: string): CoreResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return contractBreach(what);
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : contractBreach(what);
}

function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function anchorField(roots: readonly RootKey[] | undefined): { roots?: readonly RootKey[] } {
  return roots === undefined ? {} : { roots };
}

export function nativeCore(b: NativeBinding): LicenseCore {
  const jws = resultSchema(JwsViewSchema);
  const cert = resultSchema(CertificateViewSchema);
  const ent = resultSchema(EntitlementViewSchema);
  const lease = resultSchema(LeaseViewSchema);
  const binding = resultSchema(z.literal(true));
  const integrity = resultSchema(IntegrityReportSchema);
  const moduleKey = resultSchema(z.object({ anahtar: z.string() }));
  return Object.freeze({
    source: "native" as const,
    verifyJws: (token: unknown, typ: string, keys: readonly JwsKey[]): CoreResult<JwsView> =>
      decodeResult(jws, b.verifyJws(JSON.stringify({ token, typ, keys })), "JWS"),
    verifyCertificate: (token: unknown, g: { usage: CertUsage; atMs: number; roots?: readonly RootKey[] }): CoreResult<CertificateView> =>
      decodeResult(cert, b.verifyCertificate(JSON.stringify({ token, usage: g.usage, atMs: g.atMs, ...anchorField(g.roots) })), "sertifika"),
    verifyEntitlement: (token: unknown, roots?: readonly RootKey[]): CoreResult<EntitlementView> =>
      decodeResult(ent, b.verifyEntitlement(JSON.stringify({ token, ...anchorField(roots) })), "HAK"),
    verifyLease: (token: unknown, roots?: readonly RootKey[]): CoreResult<LeaseView> =>
      decodeResult(lease, b.verifyLease(JSON.stringify({ token, ...anchorField(roots) })), "kira"),
    checkLeaseBinding: (leaseJws: unknown, entitlementJws: unknown, roots?: readonly RootKey[]): CoreResult<true> =>
      decodeResult(binding, b.checkLeaseBinding(JSON.stringify({ lease: leaseJws, entitlement: entitlementJws, ...anchorField(roots) })), "kira bağı"),
    normalizeFactor: (factor: FingerprintFactor, raw: string | null | undefined): string | null => {
      const out = z.object({ value: z.string().nullable() }).safeParse(parseOrNull(b.normalizeFactor(JSON.stringify({ factor, raw: raw ?? null }))));
      return out.success ? out.data.value : null;
    },
    digestFingerprint: (raw: RawFingerprint, salt: Uint8Array): Fingerprint =>
      FingerprintSchema.parse(JSON.parse(b.digestFingerprint(JSON.stringify({ raw, salt: b64uEncode(salt) })))),
    // Sözleşme dışı yanıt ya da native istisnası parmak izini ÖLÇÜLEMEDİ yapar (lisans merdiveni), süreci düşürmez.
    collectFingerprint: async (salt: Uint8Array, f5: string | null): Promise<CollectedFingerprint> => {
      try {
        const out = CollectedSchema.safeParse(parseOrNull(await b.collectFingerprint(JSON.stringify({ salt: b64uEncode(salt), f5 }))));
        return out.success ? out.data : UNMEASURED;
      } catch {
        return UNMEASURED;
      }
    },
    verifyIntegrity: async (manifest: unknown, root: string, keys?: readonly PackageKey[]): Promise<CoreResult<IntegrityReport>> =>
      decodeResult(integrity, await b.verifyIntegrity(JSON.stringify({ manifest, root, ...(keys === undefined ? {} : { keys }) })), "bütünlük"),
    unwrapModuleKey: (wrap: unknown, privateKeyX: string, modul: string): CoreResult<{ anahtar: string }> =>
      decodeResult(moduleKey, b.unwrapModuleKey(JSON.stringify({ wrap, privateKey: privateKeyX, modul })), "modül anahtarı"),
  });
}


/** Zorunlu kipte kullanılamayan çekirdek: her doğrulama düşer, bütünlük GEÇERSİZ — istisna YOK. */
export function unavailableCore(reason: string): LicenseCore {
  const message = `Lisans çekirdeği kullanılamıyor: ${reason}`;
  const refuse = <T>(): CoreResult<T> => ({ ok: false, code: CORE_UNAVAILABLE_CODE, message });
  return Object.freeze({
    source: "yok" as const,
    verifyJws: () => refuse<JwsView>(),
    verifyCertificate: () => refuse<CertificateView>(),
    verifyEntitlement: () => refuse<EntitlementView>(),
    verifyLease: () => refuse<LeaseView>(),
    checkLeaseBinding: () => refuse<true>(),
    normalizeFactor: () => null,
    digestFingerprint: () => EMPTY_FINGERPRINT,
    collectFingerprint: async () => UNMEASURED,
    verifyIntegrity: async (): Promise<CoreResult<IntegrityReport>> => ({
      ok: true,
      value: {
        durum: "GECERSIZ",
        kod: CORE_UNAVAILABLE_CODE,
        dosyaSayisi: 0,
        eksik: [],
        eksikSayisi: 0,
        degisik: [],
        degisikSayisi: 0,
        okunamayan: [],
        okunamayanSayisi: 0,
        fazla: [],
        fazlaSayisi: 0,
        paket: null,
      },
    }),
    unwrapModuleKey: () => refuse<{ anahtar: string }>(),
  });
}
