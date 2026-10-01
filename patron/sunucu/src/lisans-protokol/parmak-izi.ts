// Bulanık parmak izi: beş etkenin kurulum tuzuyla HMAC-SHA256 özeti (ham kimlik dışarı çıkmaz)
// ve eşleşme kararı. Toplama (OS çağrıları) fabrika motorunun işidir; burada yalnız
// normalleştirme, özet ve karar. CPU kimliği bilerek YOK: makineye özgü değildir.
import { createHmac, randomBytes } from "node:crypto";
import { b64uEncode } from "./ortak";

/**
 * f1 OS makine kimliği (Win MachineGuid · Linux /etc/machine-id · mac IOPlatformUUID)
 * f2 SMBIOS UUID · f3 sistem diski kimliği (Win Get-Disk UniqueId; NVMe/SATA seri)
 * f4 sistem/anakart seri numarası (BIOS → anakart) · f5 PostgreSQL `system_identifier`.
 * MAC bilerek YOK (kullanıcı kararı); CPU kimliği makineye özgü değildir.
 */
export const FINGERPRINT_FACTORS = ["f1", "f2", "f3", "f4", "f5"] as const;
export type FingerprintFactor = (typeof FINGERPRINT_FACTORS)[number];
export type RawFingerprint = Partial<Record<FingerprintFactor, string | null>>;
/** Tuzlu özet (base64url, 43) ya da `null` = ölçülemedi. */
export type Fingerprint = Record<FingerprintFactor, string | null>;
export type MatchResult = "ESLESTI" | "ESLESMEDI" | "OLCULEMEDI";

export const FINGERPRINT_THRESHOLD = { minMatches: 3, minMeasurable: 2 } as const;
const SALT_MIN_BYTES = 16;

/** Üreticilerin doldurmadığı yer tutucular: iki makinede aynı çıkar, kimlik değildir. */
const PLACEHOLDER_VALUES = new Set([
  "none",
  "null",
  "unknown",
  "defaultstring",
  "tobefilledbyoem",
  "notapplicable",
  "notspecified",
  "systemserialnumber",
  "0123456789",
  "systemproductname",
  "chassisserialnumber",
  "baseboardserialnumber",
]);

/** RAID/sanal birimlerin genel serisi (`Volume0`, `Volume1`…): makineye özgü değildir. */
const GENERIC_DISK_SERIAL = /^volume\d*$/;

function isUniform(text: string): boolean {
  return /^(.)\1*$/.test(text);
}

/** Etken değerini kararlı biçime getirir; anlamsız/boş değer `null` (ölçülemedi) olur. */
export function normalizeFactor(factor: FingerprintFactor, raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const alnum = raw.normalize("NFKC").replace(/[^0-9A-Za-z]/g, "").toLowerCase();
  if (alnum.length === 0 || PLACEHOLDER_VALUES.has(alnum) || isUniform(alnum)) return null;
  switch (factor) {
    case "f1":
    case "f2":
      return /^[0-9a-f]{16,64}$/.test(alnum) ? alnum : null;
    case "f3":
      return alnum.length >= 4 && !GENERIC_DISK_SERIAL.test(alnum) ? alnum : null;
    case "f4":
      return alnum.length >= 4 ? alnum : null;
    case "f5":
      return /^[0-9]{1,20}$/.test(alnum) ? alnum : null;
  }
}

export function generateFingerprintSalt(): Buffer {
  return randomBytes(32);
}

/** Her etken kendi alan önekiyle özetlenir: aynı değer iki etkende çakışmasın. */
export function digestFingerprint(raw: RawFingerprint, salt: Uint8Array): Fingerprint {
  if (salt.length < SALT_MIN_BYTES) throw new Error("digestFingerprint: tuz en az 16 bayt olmalı");
  const digest = (factor: FingerprintFactor): string | null => {
    const value = normalizeFactor(factor, raw[factor]);
    if (value === null) return null;
    return b64uEncode(createHmac("sha256", salt).update(`${factor}\u001f${value}`).digest());
  };
  return { f1: digest("f1"), f2: digest("f2"), f3: digest("f3"), f4: digest("f4"), f5: digest("f5") };
}

/**
 * Kiradaki parmak izi kuralı (K8). Kira alanı YOKSA eski karar (`v1`) aynen uygulanır: ölçülemeyen etken
 * paydadan çıkar. `standart`: kabul kümesinde değeri olup ölçülemeyen etken KAYIPTIR (uyuşmazlık sayılır);
 * eşleşen ≥ 3 ve güçlülerden eşleşen ≥ 2. `zayif` (satıcı onaylı zayıf tanıma): güçlü şartı yok, eşleşen ≥ min(3, n).
 */
export const FINGERPRINT_RULES = ["standart", "zayif"] as const;
export type FingerprintRule = (typeof FINGERPRINT_RULES)[number];
export type FingerprintRuleApplied = FingerprintRule | "v1";
/** Güçlü etkenler: VM ya da disk kopyası f1 (makine kimliği) ve f5'i (PG kimliği) taşır, bunları taşımaz. */
export const STRONG_FINGERPRINT_FACTORS: readonly FingerprintFactor[] = Object.freeze(["f2", "f3", "f4"]);
export const FINGERPRINT_V2_THRESHOLD = { minMatches: 3, minStrongMatches: 2 } as const;
/** Etken bu kadar süre üst üste hiçbir yoldan okunamazsa kayıptır; o zamana dek toplayıcı son okumanın özetini kullanır. */
export const FINGERPRINT_LOSS_AFTER_MS = 24 * 60 * 60 * 1000;

export interface FingerprintDecision {
  readonly result: MatchResult;
  readonly rule: FingerprintRuleApplied;
  /** v1: iki tarafta da ölçülebilen etken sayısı · v2: kabul kümesinde değeri olan etken sayısı (n). */
  readonly measurable: number;
  readonly matched: number;
  /** v2'de kayıp etkenleri de içerir (kayıp = uyuşmazlık). */
  readonly mismatched: readonly FingerprintFactor[];
  /** Karşılaştırmaya girmeyen etkenler (v1: bir tarafta `null` · v2: kabul kümesinde `null`). */
  readonly unmeasured: readonly FingerprintFactor[];
  /** v2: kabul kümesinde değeri olup ölçülemeyen etkenler (v1'de daima boş). */
  readonly lost: readonly FingerprintFactor[];
  readonly strongMatched: number;
}

function consideredFactors(excludeF5: boolean | undefined): FingerprintFactor[] {
  return FINGERPRINT_FACTORS.filter((f) => !(f === "f5" && excludeF5));
}

function isStrong(factor: FingerprintFactor): boolean {
  return STRONG_FINGERPRINT_FACTORS.includes(factor);
}

/** v1: ölçülemeyen etken (iki taraftan birinde `null`) uyuşmazlık SAYILMAZ, paydadan çıkar. */
function compareV1(accepted: Fingerprint, measured: Fingerprint, factors: readonly FingerprintFactor[]): FingerprintDecision {
  const mismatched: FingerprintFactor[] = [];
  const unmeasured: FingerprintFactor[] = [];
  let matched = 0;
  let strongMatched = 0;
  for (const factor of factors) {
    const a = accepted[factor];
    const b = measured[factor];
    if (a === null || b === null) unmeasured.push(factor);
    else if (a === b) {
      matched++;
      if (isStrong(factor)) strongMatched++;
    } else mismatched.push(factor);
  }
  const measurable = matched + mismatched.length;
  const base = { rule: "v1" as const, measurable, matched, mismatched, unmeasured, lost: [], strongMatched };
  if (measurable < FINGERPRINT_THRESHOLD.minMeasurable) return { ...base, result: "OLCULEMEDI" };
  return { ...base, result: matched >= Math.min(FINGERPRINT_THRESHOLD.minMatches, measurable) ? "ESLESTI" : "ESLESMEDI" };
}

/** v2 (K8): kabul kümesinde değeri olan etken ölçülemiyorsa KAYIP — uyuşmazlık sayılır ama tek başına iptal değil. */
function compareV2(accepted: Fingerprint, measured: Fingerprint, factors: readonly FingerprintFactor[], rule: FingerprintRule): FingerprintDecision {
  const mismatched: FingerprintFactor[] = [];
  const unmeasured: FingerprintFactor[] = [];
  const lost: FingerprintFactor[] = [];
  let matched = 0;
  let strongMatched = 0;
  for (const factor of factors) {
    const a = accepted[factor];
    const b = measured[factor];
    if (a === null) unmeasured.push(factor);
    else if (b === null) {
      lost.push(factor);
      mismatched.push(factor);
    } else if (a === b) {
      matched++;
      if (isStrong(factor)) strongMatched++;
    } else mismatched.push(factor);
  }
  const measurable = matched + mismatched.length;
  const base = { rule, measurable, matched, mismatched, unmeasured, lost, strongMatched };
  // Zayıf kuralda boş kabul kümesi bağ değildir: eşleşti sayılmaz (fail-closed), belirsizlik merdivenine girer.
  if (rule === "zayif") {
    if (measurable === 0) return { ...base, result: "OLCULEMEDI" };
    return { ...base, result: matched >= Math.min(FINGERPRINT_V2_THRESHOLD.minMatches, measurable) ? "ESLESTI" : "ESLESMEDI" };
  }
  const ok = matched >= FINGERPRINT_V2_THRESHOLD.minMatches && strongMatched >= FINGERPRINT_V2_THRESHOLD.minStrongMatches;
  return { ...base, result: ok ? "ESLESTI" : "ESLESMEDI" };
}

/**
 * Kabul edilen küme ile ölçüleni karşılaştırır. `rule` yoksa (kira `parmakIziKurali` taşımıyor) v1 kararı:
 * en az 2 ölçülebilir VE eşleşen ≥ min(3, ölçülebilen). DR sınıfında f5 (fiziksel replikada aynı kalan PG kimliği) dışarıda.
 */
export function compareFingerprints(
  accepted: Fingerprint,
  measured: Fingerprint,
  options: { readonly excludeF5?: boolean; readonly rule?: FingerprintRule } = {},
): FingerprintDecision {
  const factors = consideredFactors(options.excludeF5);
  return options.rule === undefined ? compareV1(accepted, measured, factors) : compareV2(accepted, measured, factors, options.rule);
}

export interface IdentificationAssessment {
  /** Okunabilen etken sayısı (DR'de f5 hariç). */
  readonly readable: number;
  readonly strongReadable: number;
  /** Okunabilen < 3 ya da okunabilen güçlü < 2: etkinleştirme satıcı onayı ister, kira `zayif` kuralı taşır. */
  readonly weak: boolean;
}

/** Zayıf tanıma (K8): standart kural bu kümeyle hiç sağlanamıyorsa kurulum zayıf tanınır. */
export function assessIdentification(fingerprint: Fingerprint, options: { readonly excludeF5?: boolean } = {}): IdentificationAssessment {
  const readable = consideredFactors(options.excludeF5).filter((f) => fingerprint[f] !== null);
  const strongReadable = readable.filter(isStrong).length;
  return {
    readable: readable.length,
    strongReadable,
    weak: readable.length < FINGERPRINT_V2_THRESHOLD.minMatches || strongReadable < FINGERPRINT_V2_THRESHOLD.minStrongMatches,
  };
}

/** Meşru donanım değişikliği (K8): güçlülerden eşleşen ≥ 2 ise satıcı yeni kümeyi onaysız öğrenir. */
export function canAutoLearnFingerprint(accepted: Fingerprint, measured: Fingerprint, options: { readonly excludeF5?: boolean } = {}): boolean {
  return compareFingerprints(accepted, measured, { ...options, rule: "standart" }).strongMatched >= FINGERPRINT_V2_THRESHOLD.minStrongMatches;
}
