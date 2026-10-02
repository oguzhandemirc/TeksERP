// =============================================================================
// Parola politikası — YENİ ya da DEĞİŞEN parola için tek kaynak
// =============================================================================
// Girişte uygulanmaz (login `min(1)` bilinçli): mevcut kullanıcı kısa parolasıyla
// girmeye devam eder, yalnız bir sonraki değişiminde politikaya uyar.
// Panel aynası: Electron/src/lib/password-policy.ts (bekçi değerlerin eşitliğini ölçer).
// =============================================================================

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt 72 BAYT'tan sonrasını sessizce kırpar → üst sınır bayt cinsinden. */
export const PASSWORD_MAX_BYTES = 72;

/** Politikaya uymayan parola için Türkçe gerekçe; uyuyorsa null. */
export function passwordPolicyViolation(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return (
      `Parola ${PASSWORD_MAX_BYTES} baytı aşıyor — fazlası sessizce kırpılırdı ` +
      "(Türkçe harfler 2 bayt sayılır)."
    );
  }
  return null;
}
