// Geçerlilik bitişi zorunlu lisans sınıfları (K5): arayüz yalnız GİZLER/İSTER, karar sunucuda.
// Sunucu kaynağı `services/entitlement-policy.ts` VALIDITY_END_REQUIRED_CLASSES — birebir ayna (`test/mirrors.test.ts`).
export const VALIDITY_END_REQUIRED_CLASSES: readonly string[] = ["DEMO"];

export function isValidityEndRequired(licenseClass: string | undefined): boolean {
  return licenseClass !== undefined && VALIDITY_END_REQUIRED_CLASSES.includes(licenseClass);
}
