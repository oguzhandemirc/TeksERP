// Native lisans çekirdeğinin ADAPTÖRÜ: napi ihraçlarının şekli, native çekirdek ve zorunlu kipte kullanılamayan
// "yok" çekirdeği. Yükleyici `native.ts`, yanıt sözleşmesi (şemalar + sıkılaştırılmış varsayılanlar) `native-contract.ts`.
import { z } from "zod";
import {
  FingerprintSchema,
  OFFLINE_HORIZON_SHORT_CLASS_DAYS,
  b64uEncode,
  type CertUsage,
  type EntitlementSignerKind,
  type Fingerprint,
  type FingerprintDecision,
  type FingerprintFactor,
  type IdentificationAssessment,
  type LicenseClass,
  type RawFingerprint,
  type RootKey,
} from "./protocol";
import {
  AssessmentSchema,
  CertificateViewSchema,
  CollectedSchema,
  DecisionSchema,
  EMPTY_FINGERPRINT,
  EntitlementViewSchema,
  JwsViewSchema,
  LeaseViewSchema,
  RevocationViewSchema,
  UNIDENTIFIED,
  UNMEASURED,
  decide,
  decodeResult,
  parseOrNull,
  resultSchema,
  undecidedFingerprint,
} from "./native-contract";
import {
  CORE_UNAVAILABLE_CODE,
  type CertificateView,
  type CollectedFingerprint,
  type CoreChainOptions,
  type CoreEntitlementOptions,
  type CoreResult,
  type EntitlementView,
  type FingerprintCompareOptions,
  type JwsKey,
  type JwsView,
  type LeaseView,
  type LicenseCore,
  type RevocationView,
} from "./license-core";
import { IntegrityReportSchema, type IntegrityReport, type PackageKey } from "./integrity";
import type { LeaseModuleKeyRequest } from "./module-key";

export interface NativeBinding {
  kunye(): string;
  builtinAnchor(): string;
  verifyJws(request: string): string;
  verifyCertificate(request: string): string;
  verifyEntitlement(request: string): string;
  verifyLease(request: string): string;
  checkLeaseBinding(request: string): string;
  verifyRevocation(request: string): string;
  pickNewerRevocation(request: string): string;
  isRevocationCurrent(request: string): string;
  compareFingerprints(request: string): string;
  assessIdentification(request: string): string;
  canAutoLearnFingerprint(request: string): string;
  offlineHorizonCeilingDays(request: string): string;
  normalizeFactor(request: string): string;
  digestFingerprint(request: string): string;
  unwrapModuleKey(request: string): string;
  unwrapLeaseModuleKey(request: string): string;
  protectLocal(request: string): string;
  unprotectLocal(request: string): string;
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
  // Lisans v2 (L2-2, ABI 3 içinde): bunları taşımayan eski ABI-3 derlemesi `isNativeBinding`den geçmez → açılmaz.
  "verifyRevocation",
  "pickNewerRevocation",
  "isRevocationCurrent",
  "compareFingerprints",
  "assessIdentification",
  "canAutoLearnFingerprint",
  "offlineHorizonCeilingDays",
  "normalizeFactor",
  "digestFingerprint",
  "unwrapModuleKey",
  "unwrapLeaseModuleKey",
  "protectLocal",
  "unprotectLocal",
  "collectFingerprint",
  "verifyIntegrity",
] as const;

export function isNativeBinding(x: unknown): x is NativeBinding {
  if (typeof x !== "object" || x === null) return false;
  return BINDING_FUNCTIONS.every((name) => typeof Reflect.get(x, name) === "function");
}

/**
 * Native ÇAĞRISI istisna atarsa (panic → JS istisnası, bozuk ikili) sonuç "çekirdek yok"tur — süreç düşmez, belge
 * doğrulanmamış sayılır, lisans merdiveni işler (G12 §3.3). Yanıt şeması ayrıca `decodeResult`ta denetlenir.
 */
function guarded<T>(schema: z.ZodType<CoreResult<T>>, call: () => string, what: string): CoreResult<T> {
  let text: string;
  try {
    text = call();
  } catch {
    return { ok: false, code: CORE_UNAVAILABLE_CODE, message: `Lisans çekirdeğinin ${what} çağrısı istisna attı` };
  }
  return decodeResult(schema, text, what);
}

function anchorField(roots: readonly RootKey[] | undefined): { roots?: readonly RootKey[] } {
  return roots === undefined ? {} : { roots };
}

/** İptal metni `iptal` alanında (yoksa alan yok); `nowMs` verildiyse aynen — JSON'da NaN/±∞ `null` olur, native onu RED sayar. */
function chainFields(o: CoreEntitlementOptions | undefined): { iptal?: unknown; nowMs?: number } {
  return {
    ...(o?.revocation !== undefined && o.revocation !== null ? { iptal: o.revocation } : {}),
    ...(o?.nowMs !== undefined ? { nowMs: o.nowMs } : {}),
  };
}

type NativeV2Methods = Pick<
  LicenseCore,
  "verifyRevocation" | "pickNewerRevocation" | "isRevocationCurrent" | "compareFingerprints" | "assessIdentification" | "canAutoLearnFingerprint" | "offlineHorizonCeilingDays"
>;

/** Lisans v2 uçları (L2-2): iptal belgesi (G4) ve parmak izi v2 kararları (K8). */
function nativeV2(b: NativeBinding): NativeV2Methods {
  const revocation = resultSchema(RevocationViewSchema);
  const newerRevocation = resultSchema(RevocationViewSchema.nullable());
  const current = resultSchema(z.boolean());
  return {
    verifyRevocation: (token: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView> =>
      guarded(revocation, () => b.verifyRevocation(JSON.stringify({ token, ...anchorField(roots) })), "iptal"),
    pickNewerRevocation: (currentJws: unknown, incomingJws: unknown, roots?: readonly RootKey[]): CoreResult<RevocationView | null> =>
      guarded(newerRevocation, () => b.pickNewerRevocation(JSON.stringify({ current: currentJws ?? null, incoming: incomingJws ?? null, ...anchorField(roots) })),
        "iptal seçimi",
      ),
    isRevocationCurrent: (leaseJws: unknown, revocationJws: unknown, roots?: readonly RootKey[]): CoreResult<boolean> =>
      guarded(current, () => b.isRevocationCurrent(JSON.stringify({ lease: leaseJws, iptal: revocationJws ?? null, ...anchorField(roots) })), "iptal güncelliği"),
    // Saf kararlar: native istisnası ya da sözleşme dışı yanıt kararı SIKILAŞTIRIR (ölçülemedi · zayıf · öğrenmez · en kısa tavan).
    compareFingerprints: (accepted: Fingerprint, measured: Fingerprint, options: FingerprintCompareOptions = {}): FingerprintDecision => {
      const request = { accepted, measured, excludeF5: options.excludeF5 ?? false, ...(options.rule ? { rule: options.rule } : {}) };
      const d = decide(() => b.compareFingerprints(JSON.stringify(request)), DecisionSchema, undecidedFingerprint(options));
      return d.rule === (options.rule ?? "v1") ? d : undecidedFingerprint(options);
    },
    assessIdentification: (fingerprint: Fingerprint, options: { excludeF5?: boolean } = {}): IdentificationAssessment =>
      decide(() => b.assessIdentification(JSON.stringify({ fingerprint, excludeF5: options.excludeF5 ?? false })), AssessmentSchema, UNIDENTIFIED),
    canAutoLearnFingerprint: (accepted: Fingerprint, measured: Fingerprint, options: { excludeF5?: boolean } = {}): boolean =>
      decide(
        () => b.canAutoLearnFingerprint(JSON.stringify({ accepted, measured, excludeF5: options.excludeF5 ?? false })),
        z.object({ value: z.boolean() }),
        { value: false },
      ).value,
    offlineHorizonCeilingDays: (sinif: LicenseClass, signer: EntitlementSignerKind): number | null =>
      decide(
        () => b.offlineHorizonCeilingDays(JSON.stringify({ sinif, signer })),
        z.object({ value: z.number().int().min(1).nullable() }),
        { value: OFFLINE_HORIZON_SHORT_CLASS_DAYS },
      ).value,
  };
}

export function nativeCore(b: NativeBinding): LicenseCore {
  const jws = resultSchema(JwsViewSchema);
  const cert = resultSchema(CertificateViewSchema);
  const ent = resultSchema(EntitlementViewSchema);
  const lease = resultSchema(LeaseViewSchema);
  const binding = resultSchema(z.literal(true));
  const integrity = resultSchema(IntegrityReportSchema);
  const moduleKey = resultSchema(z.object({ anahtar: z.string() }));
  const leaseModuleKey = resultSchema(z.object({ anahtar: z.string().regex(/^[A-Za-z0-9_-]{43}$/), surum: z.number().int().min(1) }));
  const protectedData = resultSchema(z.object({ veri: z.string() }));
  return Object.freeze({
    source: "native" as const,
    verifyJws: (token: unknown, typ: string, keys: readonly JwsKey[]): CoreResult<JwsView> =>
      guarded(jws, () => b.verifyJws(JSON.stringify({ token, typ, keys })), "JWS"),
    verifyCertificate: (token: unknown, g: { usage: CertUsage; atMs: number; roots?: readonly RootKey[]; revocation?: unknown }): CoreResult<CertificateView> =>
      guarded(cert, () => b.verifyCertificate(JSON.stringify({ token, usage: g.usage, atMs: g.atMs, ...anchorField(g.roots), ...chainFields({ revocation: g.revocation }) })),
        "sertifika",
      ),
    verifyEntitlement: (token: unknown, roots?: readonly RootKey[], options?: CoreEntitlementOptions): CoreResult<EntitlementView> =>
      guarded(ent, () => b.verifyEntitlement(JSON.stringify({ token, ...anchorField(roots), ...chainFields(options) })), "HAK"),
    verifyLease: (token: unknown, roots?: readonly RootKey[], options?: CoreChainOptions): CoreResult<LeaseView> =>
      guarded(lease, () => b.verifyLease(JSON.stringify({ token, ...anchorField(roots), ...chainFields(options) })), "kira"),
    checkLeaseBinding: (leaseJws: unknown, entitlementJws: unknown, roots?: readonly RootKey[]): CoreResult<true> =>
      guarded(binding, () => b.checkLeaseBinding(JSON.stringify({ lease: leaseJws, entitlement: entitlementJws, ...anchorField(roots) })), "kira bağı"),
    ...nativeV2(b),
    normalizeFactor: (factor: FingerprintFactor, raw: string | null | undefined): string | null =>
      decide(() => b.normalizeFactor(JSON.stringify({ factor, raw: raw ?? null })), z.object({ value: z.string().nullable() }), { value: null }).value,
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
    verifyIntegrity: async (manifest: unknown, root: string, keys?: readonly PackageKey[]): Promise<CoreResult<IntegrityReport>> => {
      let text: string;
      try {
        text = await b.verifyIntegrity(JSON.stringify({ manifest, root, ...(keys === undefined ? {} : { keys }) }));
      } catch {
        return UNAVAILABLE_INTEGRITY;
      }
      return decodeResult(integrity, text, "bütünlük");
    },
    unwrapModuleKey: (wrap: unknown, privateKeyX: string, modul: string): CoreResult<{ anahtar: string }> =>
      guarded(moduleKey, () => b.unwrapModuleKey(JSON.stringify({ wrap, privateKey: privateKeyX, modul })), "modül anahtarı"),
    unwrapLeaseModuleKey: (g: LeaseModuleKeyRequest): CoreResult<{ anahtar: string; surum: number }> =>
      guarded(leaseModuleKey, () => b.unwrapLeaseModuleKey(
          JSON.stringify({ lease: g.lease, entitlement: g.entitlement, privateKey: g.privateKeyX, modul: g.modul, kid: g.kid, ...anchorField(g.roots) }),
        ),
        "kiradan modül anahtarı",
      ),
    protectLocal: (veri: string): CoreResult<{ veri: string }> => guarded(protectedData, () => b.protectLocal(JSON.stringify({ veri })), "yerel koruma"),
    unprotectLocal: (veri: string): CoreResult<{ veri: string }> => guarded(protectedData, () => b.unprotectLocal(JSON.stringify({ veri })), "yerel koruma"),
  });
}


/** Çekirdek yokken (ya da native bütünlük çağrısı istisna atınca) bütünlük GEÇERSİZ — fail-closed, süreç düşmez. */
const UNAVAILABLE_INTEGRITY: CoreResult<IntegrityReport> = Object.freeze({
  ok: true as const,
  value: Object.freeze({
    durum: "GECERSIZ" as const,
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
  }),
});

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
    verifyRevocation: () => refuse<RevocationView>(),
    pickNewerRevocation: () => refuse<RevocationView | null>(),
    isRevocationCurrent: () => refuse<boolean>(),
    compareFingerprints: (_a: Fingerprint, _m: Fingerprint, options: FingerprintCompareOptions = {}) => undecidedFingerprint(options),
    assessIdentification: () => UNIDENTIFIED,
    canAutoLearnFingerprint: () => false,
    offlineHorizonCeilingDays: () => OFFLINE_HORIZON_SHORT_CLASS_DAYS,
    normalizeFactor: () => null,
    digestFingerprint: () => EMPTY_FINGERPRINT,
    collectFingerprint: async () => UNMEASURED,
    verifyIntegrity: async (): Promise<CoreResult<IntegrityReport>> => UNAVAILABLE_INTEGRITY,
    unwrapModuleKey: () => refuse<{ anahtar: string }>(),
    unwrapLeaseModuleKey: () => refuse<{ anahtar: string; surum: number }>(),
    protectLocal: () => refuse<{ veri: string }>(),
    unprotectLocal: () => refuse<{ veri: string }>(),
  });
}
