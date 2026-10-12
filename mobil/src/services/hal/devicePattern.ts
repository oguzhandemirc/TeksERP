// Cihaz veri deseni (`identifyPattern`) tabletin geri izlemeli motorunda her çerçevede
// koşar — kayıt kapısı backend'dedir (üstel desen reddi); burada savunma: uzun girdi ve
// derlenemeyen desen okumayı kilitlemez, desensiz yola düşer.

/** Desenin koşulduğu en uzun çerçeve; üstü desene sokulmaz (uyuşmaz sayılır). */
export const PATTERN_INPUT_MAX = 256;
/** Backend `PATTERN_MAX_LENGTH` ile aynı tavan; üstü derlenmez. */
export const PATTERN_SOURCE_MAX = 255;

/** Boş, çok uzun ya da derlenemeyen desende null (çağıran desensiz davranır). */
export function compileDevicePattern(src: string | undefined | null): RegExp | null {
  if (!src || !src.trim() || src.length > PATTERN_SOURCE_MAX) return null;
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

/** Girdi tavanı aşılırsa desen koşulmaz → null. */
export function matchDevicePattern(re: RegExp, text: string): RegExpMatchArray | null {
  if (text.length > PATTERN_INPUT_MAX) return null;
  return text.match(re);
}
