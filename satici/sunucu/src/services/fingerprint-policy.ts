// PARMAK İZİ POLİTİKASI (SAF; lisans v2 K8 §3.1-6) — kabul edilen kümenin kuralı, meşru donanım değişikliğini öğrenme
// kararı ve portalın etken etken karşılaştırması. Yoklama (kayma), donanım bildirimi (otomatik kabul), kira basımı
// (`parmakIziKurali`) ve portal aynı soruyu buradan sorar. DB'ye, ağa dokunmaz.
import {
  FINGERPRINT_FACTORS,
  STRONG_FINGERPRINT_FACTORS,
  assessIdentification,
  canAutoLearnFingerprint,
  compareFingerprints,
  hasCapability,
  type Fingerprint,
  type FingerprintFactor,
  type FingerprintRule,
  type LicenseClass,
} from "../lisans-protokol";
import { installationCapabilities } from "./entitlement-policy";

/** Kiraya `parmakIziKurali` yalnız bu yeteneği bildiren alıcıya basılır (eski fabrika eski kuralı uygular). */
export const FINGERPRINT_V2_CAPABILITY = "parmak-izi-v2";

const excludeF5Of = (licenseClass: LicenseClass): boolean => licenseClass === "DR";

/**
 * Kabul edilen kümenin kuralı: kümede standart kural HİÇ sağlanamıyorsa (okunabilen < 3 ya da güçlü < 2 — zayıf tanıma)
 * `zayif`, değilse `standart`. Zayıf küme yalnız portal onayıyla (etkinleştirme) ya da v1'den gelen kurulumda doğar.
 */
export function fingerprintRuleOf(accepted: Fingerprint, licenseClass: LicenseClass): FingerprintRule {
  return assessIdentification(accepted, { excludeF5: excludeF5Of(licenseClass) }).weak ? "zayif" : "standart";
}

/** Kiranın `parmakIziKurali` alanı: alıcı `parmak-izi-v2` bildiriyorsa kümenin kuralı, değilse alan YOK (eski kural). */
export function leaseFingerprintRule(accepted: Fingerprint, licenseClass: LicenseClass, capabilities: readonly string[]): FingerprintRule | undefined {
  return hasCapability(capabilities, FINGERPRINT_V2_CAPABILITY) ? fingerprintRuleOf(accepted, licenseClass) : undefined;
}

/**
 * Meşru donanım değişikliği kendiliğinden öğrenilir mi (K8): standart kümede güçlü etkenlerden (F2 · F3 · F4) en az
 * ikisi tutuyorsa; zayıf kümede (güçlü şart yok) zayıf kural tutuyorsa. Öğrenme eski ve yeni fabrikaya AYNI uygulanır.
 */
export function canLearnFingerprint(accepted: Fingerprint, measured: Fingerprint, licenseClass: LicenseClass): boolean {
  const excludeF5 = excludeF5Of(licenseClass);
  if (fingerprintRuleOf(accepted, licenseClass) === "zayif") return compareFingerprints(accepted, measured, { excludeF5, rule: "zayif" }).result === "ESLESTI";
  return canAutoLearnFingerprint(accepted, measured, { excludeF5 });
}

/**
 * Yoklamadaki kabul kümesi uyuşmazlığı: UYARI kiranın kuralıyla (v2 alıcıda `parmakIziKurali`, fabrikanın kendi kararıyla
 * aynı), RET (K6 ikinci pencere) her alıcıda v1 eşiğiyle — eşik altı v2 uyuşmazlığı (ör. anakart değişimi) uyarı açar,
 * kira reddi doğurmaz. v2 kararı v1'den gevşek olamaz: `deniable` ⇒ `alert`.
 */
export function fingerprintMismatch(
  accepted: Fingerprint,
  measured: Fingerprint,
  installation: { readonly sinif: LicenseClass; readonly yetenekler: unknown },
  /** Yanıtı alacak tarafın bildirdiği küme; yoksa kurulum kaydı (kira basımıyla aynı kaynak). */
  receiverCapabilities: readonly string[] | undefined,
): { readonly alert: boolean; readonly deniable: boolean } {
  const licenseClass = installation.sinif;
  if (canLearnFingerprint(accepted, measured, licenseClass)) return { alert: false, deniable: false };
  const excludeF5 = excludeF5Of(licenseClass);
  const rule = leaseFingerprintRule(accepted, licenseClass, receiverCapabilities ?? installationCapabilities(installation));
  const deniable = compareFingerprints(accepted, measured, { excludeF5 }).result === "ESLESMEDI";
  const alert = rule === undefined ? deniable : deniable || compareFingerprints(accepted, measured, { excludeF5, rule }).result === "ESLESMEDI";
  return { alert, deniable };
}

export const FACTOR_STATES = ["AYNI", "FARKLI", "KAYIP", "YENI", "YOK"] as const;
export type FactorState = (typeof FACTOR_STATES)[number];

export interface FingerprintComparisonView {
  /** Etken başına: AYNI · FARKLI · KAYIP (kabulde var, bildirimde yok) · YENI (kabulde yok, bildirimde var) · YOK. */
  readonly etkenler: Readonly<Record<FingerprintFactor, FactorState>>;
  readonly guclu: readonly FingerprintFactor[];
  readonly tutanGuclu: number;
  readonly kural: FingerprintRule;
  /** Bildirilen kümeyle kural tutuyor ve kendiliğinden öğrenilebilirdi. */
  readonly ogrenilebilir: boolean;
  /** Bildirilen kümenin kendisi zayıf mı (okunabilen < 3 ya da güçlü < 2). */
  readonly zayif: boolean;
}

/** Portalın onay ekranı: ham özet DEĞİL, etken etken karşılaştırma (tuzlu özetler arayüze gitmez). */
export function fingerprintComparison(accepted: Fingerprint, reported: Fingerprint, licenseClass: LicenseClass): FingerprintComparisonView {
  const state = (f: FingerprintFactor): FactorState => {
    const a = accepted[f];
    const r = reported[f];
    if (a === null) return r === null ? "YOK" : "YENI";
    if (r === null) return "KAYIP";
    return a === r ? "AYNI" : "FARKLI";
  };
  const etkenler = Object.fromEntries(FINGERPRINT_FACTORS.map((f) => [f, state(f)])) as Record<FingerprintFactor, FactorState>;
  return {
    etkenler,
    guclu: STRONG_FINGERPRINT_FACTORS,
    tutanGuclu: STRONG_FINGERPRINT_FACTORS.filter((f) => etkenler[f] === "AYNI").length,
    kural: fingerprintRuleOf(accepted, licenseClass),
    ogrenilebilir: canLearnFingerprint(accepted, reported, licenseClass),
    zayif: assessIdentification(reported, { excludeF5: excludeF5Of(licenseClass) }).weak,
  };
}
