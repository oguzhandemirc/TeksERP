// Özel kopyanın önerilen kodu/adı — sunucu sınırlarıyla (kod 32, ad 100) kırpılır; kullanıcı onayda değiştirebilir.
// Aynı deneme tekrarında aynı gövde gider: kopya kodu sunucuda doğal idempotency anahtarıdır.
export const WEFT_CODE_MAX = 32;
export const WEFT_NAME_MAX = 100;

export function suggestForkCode(sourceCode: string, fabricCode: string): string {
  return `${sourceCode}-${fabricCode}`.slice(0, WEFT_CODE_MAX);
}

export function suggestForkName(sourceName: string, fabricCode: string): string {
  const suffix = ` (${fabricCode})`;
  return `${sourceName.slice(0, Math.max(0, WEFT_NAME_MAX - suffix.length))}${suffix}`.slice(0, WEFT_NAME_MAX);
}
