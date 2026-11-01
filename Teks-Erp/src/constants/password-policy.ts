// =============================================================================
// Parola politikası — YENİ ya da DEĞİŞEN parola için tek kaynak
// =============================================================================
// Girişte uygulanmaz (login `min(1)` bilinçli): mevcut kullanıcı kısa parolasıyla
// girmeye devam eder, yalnız bir sonraki değişiminde politikaya uyar.
// Panel aynası: Electron/src/lib/password-policy.ts (bekçi değerlerin eşitliğini ölçer).
// =============================================================================

import { COMMON_PASSWORD_CORES, COMMON_PASSWORD_DIGIT_PATTERNS } from "./common-passwords";

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt 72 BAYT'tan sonrasını sessizce kırpar → üst sınır bayt cinsinden. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Parola özetinin bcrypt tur sayısı — TEK KAYNAK (parola, ayar şifresi, kurulum aracı, seed).
 * 10 → 12 (güvenlik denetimi B4, 2026-10-13): döküm sızarsa çevrimdışı kırma 4× pahalı.
 * Eski özet başarılı parolalı girişte bu değere yükseltilir (`AuthService.login`).
 */
export const PASSWORD_BCRYPT_COST = 12;

/**
 * Politikaya uymayan parola için Türkçe gerekçe; uyuyorsa null.
 * `contextWords`: kuruluma özgü tahmin edilebilir sözcükler (firma adı) — bkz. `lib/new-password-policy.ts`.
 */
export function passwordPolicyViolation(password: string, contextWords: readonly string[] = []): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Parola en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`;
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    return (
      `Parola ${PASSWORD_MAX_BYTES} baytı aşıyor — fazlası sessizce kırpılırdı ` +
      "(Türkçe harfler 2 bayt sayılır)."
    );
  }
  if (isCommonPassword(password)) {
    return "Bu parola çok yaygın ve kolay tahmin edilir — sözlükte geçmeyen, size özel bir parola seçin.";
  }
  if (isContextDerived(password, contextWords)) {
    return "Parola firma adından türetilmiş — kolay tahmin edilir. Firma adını içermeyen bir parola seçin.";
  }
  return null;
}

const TR_FOLD: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Küçük harf + Türkçe harf katlama + harf dışı atma: "Şifre2024!" → "sifre". */
export function passwordCore(password: string): string {
  const lower = password.toLowerCase().replace(/i̇/g, "i");
  let out = "";
  for (const ch of lower) {
    const f = TR_FOLD[ch] ?? ch;
    if (f >= "a" && f <= "z") out += f;
  }
  return out;
}

const COMMON_CORE_SET = new Set(COMMON_PASSWORD_CORES);
const SEQUENCES = ["01234567890123456789", "98765432109876543210"];

function isCommonPassword(password: string): boolean {
  // Tam biçim deseni kökten ÖNCE: harfli klavye desenleri ("1qaz2wsx3edc") kök denetimine hiç düşmez.
  if (COMMON_PASSWORD_DIGIT_PATTERNS.includes(password.toLowerCase())) return true;
  const core = passwordCore(password);
  if (core) return COMMON_CORE_SET.has(core);
  const digits = password.replace(/[^0-9]/g, "");
  if (digits.length === 0) return false;
  if (new Set(digits).size <= 2) return true;
  return SEQUENCES.some((seq) => seq.includes(digits));
}

/** Firma adının ayrıştırılmış parçaları ve ortak ekleri silinince geriye 3 harften az kalıyorsa türetilmiştir. */
const COMPANY_FILLER = ["sanayi", "ticaret", "limited", "sirketi", "anonim", "tekstil", "san", "tic", "ltd", "sti", "as", "ve"];

function isContextDerived(password: string, contextWords: readonly string[]): boolean {
  const tokens = new Set<string>();
  for (const w of contextWords) {
    for (const part of w.split(/[^\p{L}\p{N}]+/u)) {
      const c = passwordCore(part);
      if (c.length >= 3) tokens.add(c);
    }
  }
  const meaningful = [...tokens].filter((t) => !COMPANY_FILLER.includes(t));
  if (meaningful.length === 0) return false;
  let core = passwordCore(password);
  if (!meaningful.some((t) => core.includes(t))) return false;
  for (const t of [...meaningful, ...COMPANY_FILLER].sort((a, b) => b.length - a.length)) core = core.split(t).join("");
  return core.length < 3;
}

/** Parola doğrulamalı uçlarda (parola değişimi, web 2FA kapatma) "mevcut parola yanlış" kodu. */
export const CURRENT_PASSWORD_INVALID_CODE = "CURRENT_PASSWORD_INVALID";
