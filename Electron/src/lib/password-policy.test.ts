import { describe, it, expect } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  newPasswordSchema,
  passwordPolicyViolation,
} from "./password-policy";

// Backend `constants/password-policy.ts` aynası: aynı eşikler, aynı Türkçe mesajlar.
describe("parola politikası (yeni/değişen parola)", () => {
  it("eşikler backend ile aynı: en az 10 karakter, en fazla 72 bayt", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it("9 karakter REDDEDİLİR, 10 karakter kabul edilir", () => {
    expect(passwordPolicyViolation("a".repeat(9))).toBe("Parola en az 10 karakter olmalı.");
    expect(passwordPolicyViolation("a".repeat(10))).toBeNull();
  });

  it("72 bayt sınırı BAYT sayar: 36 Türkçe harf (72 bayt) geçer, 37 (74 bayt) reddedilir", () => {
    expect(passwordPolicyViolation("ş".repeat(36))).toBeNull();
    expect(passwordPolicyViolation("ş".repeat(37))).toBe(
      "Parola 72 baytı aşıyor — fazlası sessizce kırpılırdı (Türkçe harfler 2 bayt sayılır).",
    );
    // 72 ASCII geçer, 73 ASCII reddedilir.
    expect(passwordPolicyViolation("a".repeat(72))).toBeNull();
    expect(passwordPolicyViolation("a".repeat(73))).not.toBeNull();
  });

  it("zod alanı aynı gerekçeyi taşır", () => {
    const kisa = newPasswordSchema.safeParse("kisa");
    expect(kisa.success).toBe(false);
    expect(kisa.error?.issues[0]?.message).toBe("Parola en az 10 karakter olmalı.");
    expect(newPasswordSchema.safeParse("yeterince-uzun").success).toBe(true);
  });
});
