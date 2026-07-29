/**
 * Unique-friendly otomatik kod üretici (ESKİ format: <PREFIX>-YYMMDD-XXXX).
 *
 * ⚠️ MASTER-DATA İÇİN KULLANMA. Renk/İstasyon/Makine/Hata/Rota/Reçete/İade/Özellik
 * kodları artık BACKEND'de `PREFIX+GGAAYY+NNNN` günlük sıralı üretiliyor
 * (BaseService `autoCode` config'i) — istemci `code` göndermez. Bu helper yalnız
 * henüz taşınmamış Fason firma (FSN) ve Fason kategori (KAT) için kaldı; yeni
 * master-data eklerken de kod gönderme, backend'e `autoCode` ekle.
 *
 * Format: <PREFIX>-YYMMDD-XXXX  (XXXX 4-haneli random).
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
  RETURN_REASON: "IADE",
} as const;
