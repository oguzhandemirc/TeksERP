// =============================================================================
// Parola politikası — YENİ ya da DEĞİŞEN parola için tek kaynak (panel)
// =============================================================================
// Backend aynası: Teks-Erp/src/constants/password-policy.ts; bekçi değer eşitliğini
// ölçer (sabit adları ve `= 10;` / `= 72;` biçimi korunur, mesajlar birebir).
// Girişte uygulanmaz: giriş formu `min(1)` kalır (mevcut kısa parolayla giriş sürer).
// =============================================================================

import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt 72 BAYT'tan sonrasını sessizce kırpar → üst sınır bayt cinsinden. */
export const PASSWORD_MAX_BYTES = 72;

/** Politikaya uymayan parola için Türkçe gerekçe; uyuyorsa null. */
export function passwordPolicyViolation(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`;
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return (
      `Parola ${PASSWORD_MAX_BYTES} baytı aşıyor — fazlası sessizce kırpılırdı ` +
      "(Türkçe harfler 2 bayt sayılır)."
    );
  }
  return null;
}

/** Yeni/değişen parola alanı (oluşturma · sıfırlama · zorunlu değişim) — giriş formunda KULLANILMAZ. */
export const newPasswordSchema = z.string().superRefine((value, ctx) => {
  const violation = passwordPolicyViolation(value);
  if (violation) ctx.addIssue({ code: "custom", message: violation });
});
