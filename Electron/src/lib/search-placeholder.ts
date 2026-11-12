/** Liste arama kutusu yer tutucusu en çok bu kadar karakter (kullanıcı 2026-11-12: "placeholder'ları kısa tut"). */
export const SEARCH_PLACEHOLDER_MAX = 20;
export const DEFAULT_SEARCH_PLACEHOLDER = "Ara…";

/**
 * Kısa yer tutucu + tam açıklama. Uzun metin yer tutucuda kırpılırdı: kutuda "Ara…" kalır, neyin arandığı
 * `title`/`aria-label`a taşınır (bilgi kaybolmaz).
 */
export function searchLabels(placeholder?: string, hint?: string): { placeholder: string; hint: string } {
  const text = placeholder?.trim() || DEFAULT_SEARCH_PLACEHOLDER;
  const short = text.length <= SEARCH_PLACEHOLDER_MAX ? text : DEFAULT_SEARCH_PLACEHOLDER;
  return { placeholder: short, hint: hint ?? (short === text ? "Ara" : text.replace(/(\.\.\.|…)$/, "")) };
}
