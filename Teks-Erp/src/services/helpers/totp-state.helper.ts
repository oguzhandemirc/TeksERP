// =============================================================================
// TOTP'NİN KANONİK DURUMU — saklanan sırrın AÇIK değerine tek okuyucu
// =============================================================================
// Giriş doğrulaması (`totp-account.service`) ve sistem hesabı mührü (`system-account-seal.helper`)
// TOTP sırrını yalnız `openStoredTotpSecret` ile okur. Saklama biçimi (bugün düz; şifreleme gelince
// sarılı) burada açılır ⇒ mühür özeti açık sırdan doğar, şifreleme geçişi mühürleri bozmaz.
// Ayrı modül: mühür yardımcısı `totp-account.service`i içe alırsa değer import döngüsü doğar.
// =============================================================================
import { createHash } from "node:crypto";

type SecretOpener = (stored: string) => string;
const PLAIN_OPENER: SecretOpener = (stored) => stored;
let opener: SecretOpener = PLAIN_OPENER;

/** Saklanan TOTP sırrı (kullanıcı ya da kurulum penceresi) → açık base32; boş → null. */
export function openStoredTotpSecret(stored: string | null | undefined): string | null {
  return stored ? opener(stored) : null;
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
 */
export function totpSealLines(row: TotpSealSource): string[] {
  const secret = openStoredTotpSecret(row.totpSecret);
  const proven = secret !== null && row.totpEnrollments.some((e) => openStoredTotpSecret(e.secret) === secret);
  const codes = row.recoveryCodes.map((c) => c.codeHash).sort().join("\n");
  return [
    `t:${secret === null ? "" : sha256(secret)}`,
    `T:${row.totpEnabledAt?.toISOString() ?? ""}`,
    `a:${proven ? 1 : 0}`,
    `r:${sha256(codes)}`,
  ];
}

/** Bekçi: saklama biçimini (ör. şifreli sarma) taklit eder; `null` düz biçime döner. */
export function setTotpSecretOpenerForTest(fn: SecretOpener | null): void {
  opener = fn ?? PLAIN_OPENER;
}
