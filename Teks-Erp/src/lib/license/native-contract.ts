// Native lisans çekirdeğinin SÖZLEŞMESİ: yanıt şemaları, sözleşme dışı yanıtın kodu ve native'in karar veremediği
// hâllerde kullanılan SIKILAŞTIRILMIŞ varsayılanlar (ölçülemedi · zayıf tanıma). Adaptör `native-adapter.ts`tedir.
// Native yanıtı bu şemalardan geçirilir: native'deki bir hata sessiz kabul üretemez.
import { z } from "zod";
import {
  CertificateSchema,
  EntitlementSchema,
  FINGERPRINT_FACTORS,
  FINGERPRINT_RULES,
  FingerprintSchema,
  LeaseSchema,
  LICENSE_CLASSES,
  RevocationSchema,
  isPlainObject,
  type EntitlementSignerKind,
  type Fingerprint,
  type FingerprintDecision,
  type IdentificationAssessment,
} from "./protocol";
import { ALL_CORE_RESULT_CODES, CORE_UNAVAILABLE_CODE, type CollectedFingerprint, type CoreResult, type FingerprintCompareOptions } from "./license-core";

const CodeSchema = z.enum(ALL_CORE_RESULT_CODES);
export function resultSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), code: CodeSchema, message: z.string() }),
  ]);
}
export const JwsViewSchema = z.object({
  header: z.object({ alg: z.literal("EdDSA"), typ: z.string(), kid: z.string() }),
  // `z.record` yeni nesne kurar ve `__proto__` anahtarını prototipe yazar (yükten düşer); yük AYNEN geçer.
  payload: z.custom<Record<string, unknown>>(isPlainObject),
});
export const CertificateViewSchema = z.object({ document: CertificateSchema, rootKid: z.string(), allowedClasses: z.array(z.enum(LICENSE_CLASSES)) });
const SIGNER_KINDS = ["KOK", "BAYI", "ARA"] as const satisfies readonly EntitlementSignerKind[];
export const EntitlementViewSchema = z.object({
  document: EntitlementSchema,
  signer: z.object({ kind: z.enum(SIGNER_KINDS), kid: z.string(), rootKid: z.string() }),
});
export const RevocationViewSchema = z.object({ document: RevocationSchema, rootKid: z.string() });
const FactorListSchema = z.array(z.enum(FINGERPRINT_FACTORS));
const CountSchema = z.number().int().min(0).max(FINGERPRINT_FACTORS.length);
export const DecisionSchema = z.object({
  result: z.enum(["ESLESTI", "ESLESMEDI", "OLCULEMEDI"]),
  rule: z.enum(["v1", ...FINGERPRINT_RULES]),
  measurable: CountSchema,
  matched: CountSchema,
  mismatched: FactorListSchema,
  unmeasured: FactorListSchema,
  lost: FactorListSchema,
  strongMatched: CountSchema,
});
export const AssessmentSchema = z.object({ readable: CountSchema, strongReadable: CountSchema, weak: z.boolean() });
export const LeaseViewSchema = z.object({ document: LeaseSchema, subCertificate: CertificateViewSchema });
export const CollectedSchema = z.object({
  digest: FingerprintSchema,
  measured: z.object({ f1: z.boolean(), f2: z.boolean(), f3: z.boolean(), f4: z.boolean(), f5: z.boolean() }),
});

export const EMPTY_FINGERPRINT: Fingerprint = Object.freeze({ f1: null, f2: null, f3: null, f4: null, f5: null });
export const UNMEASURED: CollectedFingerprint = Object.freeze({
  digest: EMPTY_FINGERPRINT,
  measured: Object.freeze({ f1: false, f2: false, f3: false, f4: false, f5: false }),
});

function contractBreach<T>(what: string): CoreResult<T> {
  return { ok: false, code: CORE_UNAVAILABLE_CODE, message: `Lisans çekirdeğinin ${what} yanıtı sözleşmeye uymuyor` };
}

export function decodeResult<T>(schema: z.ZodType<CoreResult<T>>, text: string, what: string): CoreResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return contractBreach(what);
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : contractBreach(what);
}

/** Native'in karar veremediği (istisna · sözleşme dışı yanıt) parmak izi: ÖLÇÜLEMEDİ — belirsizlik merdivenine girer. */
export function undecidedFingerprint(options: FingerprintCompareOptions): FingerprintDecision {
  const unmeasured = FINGERPRINT_FACTORS.filter((f) => !(f === "f5" && options.excludeF5));
  return { result: "OLCULEMEDI", rule: options.rule ?? "v1", measurable: 0, matched: 0, mismatched: [], unmeasured, lost: [], strongMatched: 0 };
}

export const UNIDENTIFIED: IdentificationAssessment = Object.freeze({ readable: 0, strongReadable: 0, weak: true });

/** Saf karar çağrısı: native istisnası ya da sözleşme dışı yanıt `fallback`e düşer (süreç düşmez, karar sıkılaşır). */
export function decide<T>(call: () => string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const out = schema.safeParse(JSON.parse(call()));
    return out.success ? out.data : fallback;
  } catch {
    return fallback;
  }
}

export function parseOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
