// Bulanık parmak izi: beş etkenin kurulum tuzuyla HMAC-SHA256 özeti (ham kimlik dışarı çıkmaz)
// ve eşleşme kararı. Toplama (OS çağrıları) fabrika motorunun işidir; burada yalnız
// normalleştirme, özet ve karar. CPU kimliği bilerek YOK: makineye özgü değildir.
import { createHmac, randomBytes } from "node:crypto";
import { b64uEncode } from "./ortak";

/**
 * f1 OS makine kimliği (Win MachineGuid · Linux /etc/machine-id · mac IOPlatformUUID)
 * f2 SMBIOS UUID · f3 sistem diski seri no · f4 birincil FİZİKSEL ağ kartının kalıcı MAC'i
 * f5 PostgreSQL `system_identifier` (pg_control_system()).
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
]);

function isUniform(text: string): boolean {
  return /^(.)\1*$/.test(text);
}

function normalizeMac(alnum: string): string | null {
  if (!/^[0-9a-f]{12}$/.test(alnum)) return null;
  const firstOctet = parseInt(alnum.slice(0, 2), 16);
  // Yerel yönetimli (sanal/rastgele) ya da çok noktaya yayın MAC fiziksel kart kimliği değildir.
  if ((firstOctet & 0x02) !== 0 || (firstOctet & 0x01) !== 0) return null;
  return alnum;
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
      return alnum.length >= 4 ? alnum : null;
    case "f4":
      return normalizeMac(alnum);
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

export interface FingerprintDecision {
  readonly result: MatchResult;
  /** İki tarafta da ölçülebilen etken sayısı. */
  readonly measurable: number;
  readonly matched: number;
  readonly mismatched: readonly FingerprintFactor[];
  readonly unmeasured: readonly FingerprintFactor[];
}

/**
 * Kabul edilen küme ile ölçüleni karşılaştırır. Ölçülemeyen etken (iki taraftan birinde
 * `null`) uyuşmazlık SAYILMAZ, paydadan çıkar. Karar: en az 2 ölçülebilir VE eşleşen
 * ≥ min(3, ölçülebilen). DR sınıfında f5 (fiziksel replikada aynı kalan PG kimliği) dışarıda.
 */
export function compareFingerprints(
  accepted: Fingerprint,
  measured: Fingerprint,
  options: { readonly excludeF5?: boolean } = {},
): FingerprintDecision {
  const mismatched: FingerprintFactor[] = [];
  const unmeasured: FingerprintFactor[] = [];
  let matched = 0;
  for (const factor of FINGERPRINT_FACTORS) {
    if (factor === "f5" && options.excludeF5) continue;
    const a = accepted[factor];
    const b = measured[factor];
    if (a === null || b === null) unmeasured.push(factor);
    else if (a === b) matched++;
    else mismatched.push(factor);
  }
  const measurable = matched + mismatched.length;
  if (measurable < FINGERPRINT_THRESHOLD.minMeasurable) {
    return { result: "OLCULEMEDI", measurable, matched, mismatched, unmeasured };
  }
  const required = Math.min(FINGERPRINT_THRESHOLD.minMatches, measurable);
  return { result: matched >= required ? "ESLESTI" : "ESLESMEDI", measurable, matched, mismatched, unmeasured };
}
