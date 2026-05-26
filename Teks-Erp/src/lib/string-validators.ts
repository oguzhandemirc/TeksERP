// =============================================================================
// String alan validatörleri — paylaşımlı saf-fonksiyon helper'lar
// =============================================================================
// Tipik kullanım deseni (CustomerService.validateTaxNumber ile aynı):
//
//   import { validateName, validateCode } from "../lib/string-validators";
//
//   async create(data) {
//     const name = validateName(data.name, { required: true });
//     if (name !== undefined) data.name = name;
//     const code = validateCode(data.code, { required: true });
//     if (code !== undefined) data.code = code;
//     return super.create(data);
//   }
//
// Her validator:
//   - `undefined`   → değişiklik yok (PATCH semantics)
//   - `null` / `""` → required ise AppError, opsiyonel ise null
//   - geçerli       → trim'lenmiş string
//   - geçersiz      → AppError.badRequest (Türkçe)
//
// Default limitler textil ERP için makul — UI/etiket render'a ve DB index
// performansına dayalı:
//   NAME_MAX_LEN  = 200   (ürün/müşteri/fason adı, etiket başlığı sığar)
//   CODE_MAX_LEN  = 50    (KUM-001 / MUS-T10 gibi)
//   LONGTEXT_MAX  = 1000  (description, notlar)
// =============================================================================

import { AppError } from "../utils/app-error";

export const NAME_MAX_LEN = 200;
export const CODE_MAX_LEN = 50;
export const LONGTEXT_MAX = 1000;

export interface StringValidatorOptions {
  /** Boş/null reddedilir, dolu zorunludur. */
  required?: boolean;
  /** Alan adı — hata mesajında görünür ("Ürün adı" vb.). */
  label?: string;
  /** Override default max length. */
  maxLen?: number;
  /** Override default min length (default 1 — boş değil). */
  minLen?: number;
}

/**
 * Generic string validator. validateName / validateCode / validateLongText
 * bunun thin wrapper'ı.
 */
function validateString(
  raw: unknown,
  opts: StringValidatorOptions & { defaultLabel: string; defaultMax: number }
): string | null | undefined {
  const {
    required = false,
    label = opts.defaultLabel,
    maxLen = opts.defaultMax,
    minLen = 1,
  } = opts;

  if (raw === undefined) {
    if (required) throw AppError.badRequest(`${label} zorunlu`);
    return undefined;
  }
  if (raw === null) {
    if (required) throw AppError.badRequest(`${label} zorunlu`);
    return null;
  }
  if (typeof raw !== "string") {
    throw AppError.badRequest(`${label} metin olmalı`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (required) throw AppError.badRequest(`${label} boş olamaz`);
    return null;
  }
  if (trimmed.length < minLen) {
    throw AppError.badRequest(`${label} en az ${minLen} karakter olmalı`);
  }
  if (trimmed.length > maxLen) {
    throw AppError.badRequest(`${label} en fazla ${maxLen} karakter olmalı`);
  }
  return trimmed;
}

/** Ad/isim alanları için (Item.name, Customer.name, Color.name...). */
export function validateName(
  raw: unknown,
  opts: StringValidatorOptions = {}
): string | null | undefined {
  return validateString(raw, {
    ...opts,
    defaultLabel: opts.label ?? "İsim",
    defaultMax: NAME_MAX_LEN,
  });
}

/**
 * URL-safe kod alanları için regex (Item.code, Customer.code, Station.code...).
 * Alfanümerik ASCII + tire + alt çizgi. İçeride boşluk, Türkçe karakter,
 * özel sembol yasak — URL/import/export'ta sorun yaratmasın diye.
 *   ✓ "KUM-001", "MUS_T10", "ABC123"
 *   ✗ "KUM 001", "MÜŞ-1", "ABC#1"
 */
const CODE_REGEX = /^[A-Za-z0-9_-]+$/;

/** Kod alanları için (Item.code, Customer.code...). */
export function validateCode(
  raw: unknown,
  opts: StringValidatorOptions = {}
): string | null | undefined {
  const label = opts.label ?? "Kod";
  const trimmed = validateString(raw, {
    ...opts,
    defaultLabel: label,
    defaultMax: CODE_MAX_LEN,
  });
  // Sadece dolu string için regex kontrolü — undefined/null/boş zaten yukarıda
  // (required koşuluna göre) ele alındı.
  if (typeof trimmed === "string" && !CODE_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      `${label} sadece harf, rakam, tire (-) ve alt çizgi (_) içerebilir (boşluk ve Türkçe karakter yasak)`
    );
  }
  return trimmed;
}

/** Açıklama/not alanları için (description, notes, address gibi uzun metin). */
export function validateLongText(
  raw: unknown,
  opts: StringValidatorOptions = {}
): string | null | undefined {
  return validateString(raw, {
    ...opts,
    defaultLabel: opts.label ?? "Metin",
    defaultMax: LONGTEXT_MAX,
  });
}

/**
 * Hex renk kodu validatörü — Color.hex, QualityGrade.color, FabricProperty.color
 * gibi UI rozetlerinde kullanılan alanlar için.
 *   ✓ "#10b981", "#FF00AA", "#abc" (3 veya 6 hane)
 *   ✗ "kirmizi", "#GG0000", "10b981" (# yok)
 */
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function validateHexColor(
  raw: unknown,
  opts: { required?: boolean; label?: string } = {},
): string | null | undefined {
  const { required = false, label = "Renk kodu" } = opts;
  if (raw === undefined) {
    if (required) throw AppError.badRequest(`${label} zorunlu`);
    return undefined;
  }
  if (raw === null) {
    if (required) throw AppError.badRequest(`${label} zorunlu`);
    return null;
  }
  if (typeof raw !== "string") {
    throw AppError.badRequest(`${label} metin olmalı`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    if (required) throw AppError.badRequest(`${label} boş olamaz`);
    return null;
  }
  if (!HEX_COLOR_REGEX.test(trimmed)) {
    throw AppError.badRequest(
      `${label} geçerli bir hex değeri olmalı (#RRGGBB veya #RGB)`,
    );
  }
  return trimmed;
}
