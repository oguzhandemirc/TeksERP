/**
 * Unique-friendly otomatik kod üretici.
 * Format: <PREFIX>-YYMMDD-XXXX  (XXXX 4-haneli random)
 *
 * Örnekler:
 *   generateCode("MUS")  → "MUS-260507-4729"
 *   generateCode("ROT")  → "ROT-260507-9182"
 *
 * Çakışma riski çok düşük (saniyede 9000 farklı kod). Backend `@unique` ihlal
 * yakalarsa toast'ta hata mesajı görünür, kullanıcı yeniden dener.
 */
export function generateCode(prefix: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix}-${yy}${mm}${dd}-${rand}`;
}

export const CODE_PREFIXES = {
  CUSTOMER: "MUS",
  ITEM: "URN",
  STATION: "IST",
  MACHINE: "MAK",
  DEFECT_TYPE: "HATA",
  QUALITY_GRADE: "KAL",
  COLOR: "RNK",
  ROUTE: "ROT",
  FABRIC_PROPERTY: "OZL",
  RECIPE: "REC",
} as const;
