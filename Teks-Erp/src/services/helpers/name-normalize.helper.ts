// =============================================================================
// Saha #13 — ürün/renk adı standartları
// =============================================================================
// Ürün (kumaş) adları: HEPSİ BÜYÜK (tr locale — i→İ doğru dönsün).
// Renk adları: BÜYÜK + boşluk yerine tire + SAYI BLOKLARI BAŞTA.
//   "beyaz 055"   → "055-BEYAZ"
//   "krem gümüş"  → "KREM-GÜMÜŞ"
//   "055-BEYAZ"   → "055-BEYAZ" (idempotent)
// Filtre/aramalar normalize edilmiş depolamayla tutarlı çalışır.
// =============================================================================

/** Ürün adı: trim + çoklu boşluk tekle + Türkçe büyük harf. Boşluklar KORUNUR. */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

/**
 * Renk adı: Türkçe büyük harf, ayraçlar (boşluk/tire) token'lara bölünür,
 * SALT-RAKAM token'lar başa alınır (kendi sıralarıyla), tümü tire ile birleşir.
 */
export function normalizeColorName(name: string): string {
  const tokens = name
    .trim()
    .toLocaleUpperCase("tr-TR")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  const rest = tokens.filter((t) => !/^\d+$/.test(t));
  return [...numeric, ...rest].join("-");
}
