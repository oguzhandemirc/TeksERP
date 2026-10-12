// =============================================================================
// TOTP'NİN KANONİK DURUMU — saklanan sırrın AÇIK değerine tek okuyucu, sarılı değere tek yazıcı
// =============================================================================
// Giriş doğrulaması (`totp-account.service`) ve sistem hesabı mührü (`system-account-seal.helper`)
// TOTP sırrını yalnız `openStoredTotpSecret` ile okur; DB'ye yazan tek yol `storeTotpSecret`tir.
// Saklama biçimi `enc1:` sarmalıdır (anahtar LICENSE_DIR halkasından — `totp-crypto.ts`); geçiş
// döneminden kalan düz değer okunur, açılış işi onu sarar. Mühür özeti AÇIK sırdan doğar.
// Ayrı modül: mühür yardımcısı `totp-account.service`i içe alırsa değer import döngüsü doğar.
// =============================================================================
import { createHash } from "node:crypto";
import { AppError } from "../../utils/app-error";
import { getShortCredentialKeyRing } from "../../lib/short-credential/keyring";
import { isSealedTotpSecret, openTotpSecret, sealTotpSecret } from "../../lib/short-credential/totp-crypto";

type SecretOpener = (stored: string) => string | null;
type SecretSealer = (plain: string) => string;

const RING_OPENER: SecretOpener = (stored) => {
  if (!isSealedTotpSecret(stored)) return stored;
  const st = getShortCredentialKeyRing();
  return st.ok ? openTotpSecret(st.ring, stored) : null;
};

/** Halka yoksa sır YAZILAMAZ — düz değere düşmek yerine 503 (PIN özetiyle aynı disiplin). */
const RING_SEALER: SecretSealer = (plain) => {
  const st = getShortCredentialKeyRing();
  if (!st.ok) {
    throw new AppError(
      `TOTP anahtarı kullanılamıyor (${st.detail}). İki adımlı doğrulama şu an kurulamaz — lisans deposunu (LICENSE_DIR) kontrol edin.`,
      503,
      true,
      { code: "TOTP_KEY_UNAVAILABLE" },
    );
  }
  return sealTotpSecret(st.ring.active, plain);
};

let opener: SecretOpener = RING_OPENER;
let sealer: SecretSealer = RING_SEALER;

/** Saklanan TOTP sırrı (kullanıcı ya da kurulum penceresi) → açık base32; boş → null; sarılı ama AÇILAMIYOR → null. */
export function openStoredTotpSecret(stored: string | null | undefined): string | null {
  return stored ? opener(stored) : null;
}

export const TOTP_SECRET_UNREADABLE_CODE = "TOTP_SECRET_UNREADABLE";

/** Sır var ama açılamıyorsa 503: 2FA sessizce kapanmaz, giriş de düz değere düşmez (fail-closed). */
export function openStoredTotpSecretOrThrow(stored: string): string {
  const plain = opener(stored);
  if (plain === null) {
    throw new AppError(
      "TOTP sırrı bu sunucunun anahtarıyla çözülemiyor (yedek başka sunucudan ya da anahtar halkası eksik) — lisans deposunu kontrol edin.",
      503,
      true,
      { code: TOTP_SECRET_UNREADABLE_CODE },
    );
  }
  return plain;
}

/** Açık sır → DB'ye yazılacak sarılı değer. Tek yazıcı: `totpEnrollment.secret` yalnız buradan geçer. */
export function storeTotpSecret(plain: string): string {
  return sealer(plain);
}

/** Mührün okuduğu TOTP kolonları (`SEAL_ROW_SELECT` bunu yayar). */
export const TOTP_SEAL_SELECT = {
  totpSecret: true,
  totpEnabledAt: true,
  totpEnrollments: { where: { consumedAt: { not: null } }, select: { secret: true } },
  recoveryCodes: { select: { codeHash: true } },
} as const;

export interface TotpSealSource {
  readonly totpSecret: string | null;
  readonly totpEnabledAt: Date | null;
  /** Tüketilmiş kurulum pencerelerinin sırları — "sır kanıtlandı mı" (`readActive` ile aynı ölçüt). */
  readonly totpEnrollments: ReadonlyArray<{ readonly secret: string }>;
  readonly recoveryCodes: ReadonlyArray<{ readonly codeHash: string }>;
}

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Mühre giren TOTP satırları. `totpLastStep` ve kurtarma kodunun `usedAt`i GİRMEZ: girişte değişir,
 * kimliği değiştirmez. Kanıt (`a:`) girer: tüketilmiş pencere satırını silmek 2FA'yı sessizce kapatırdı.
 * Sır var ama açılamıyorsa `t:!` — özet tutmaz, mühür geçersiz kalır (fail-closed).
 */
export function totpSealLines(row: TotpSealSource): string[] {
  const secret = openStoredTotpSecret(row.totpSecret);
  const unreadable = row.totpSecret !== null && row.totpSecret !== "" && secret === null;
  const proven = secret !== null && row.totpEnrollments.some((e) => openStoredTotpSecret(e.secret) === secret);
  const codes = row.recoveryCodes.map((c) => c.codeHash).sort().join("\n");
  return [
    `t:${unreadable ? "!" : secret === null ? "" : sha256(secret)}`,
    `T:${row.totpEnabledAt?.toISOString() ?? ""}`,
    `a:${proven ? 1 : 0}`,
    `r:${sha256(codes)}`,
  ];
}

/** Bekçi: saklama biçimini taklit eder; `null` halkalı biçime döner. */
export function setTotpSecretOpenerForTest(fn: SecretOpener | null): void {
  opener = fn ?? RING_OPENER;
}

/** Bekçi (negatif sonda): yazıcıyı değiştirir; `null` halkalı sarmala döner. */
export function setTotpSecretSealerForTest(fn: SecretSealer | null): void {
  sealer = fn ?? RING_SEALER;
}
