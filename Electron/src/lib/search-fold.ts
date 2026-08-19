// =============================================================================
// ARAMA KATLAMASI — Türkçe ↔ ASCII duyarsız metin eşleştirme (2026-08-19)
// =============================================================================
// Saha talebi: "canakkale" ile "çanakkale" AYNI sonucu vermeli. Sunucu tarafı
// aramalarda bu zaten çözülü (`buildTurkishSearch` terim varyantları üretir);
// bu dosya İSTEMCİDE bellekteki listeyi süzen yerler içindir (yetki gridi,
// kullanıcı listesi, rol listesi, istasyon yetenekleri).
//
// ⚠️ DÜZ `toLowerCase()` TÜRKÇEDE BOZUKTUR ve buradaki asıl hata sınıfı buydu:
// "ŞAHİN".toLowerCase() → "şahi̇n" — İ, `i` + BİRLEŞTİRİCİ NOKTA (U+0307) olur
// ve "sahin" ile eşleşmez. Görünüşte aynı, bayt olarak farklı. Bu yüzden önce
// `toLocaleLowerCase("tr")` ile doğru küçültme, sonra ASCII indirgeme.
//
// ⚠️ Bu KARŞILAŞTIRMA katlamasıdır — depolanan değeri DEĞİŞTİRMEZ. Depolama
// tarafının kuralı ayrıdır ve BÜYÜK harftir (backend `normalizeDisplayName`).
// =============================================================================

const TR_TO_ASCII: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

/**
 * Metni arama-karşılaştırmasına uygun ASCII biçimine indirger.
 * "ÇANAKKALE" · "çanakkale" · "Canakkale" → hepsi "canakkale".
 */
export function foldSearchText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşü]/g, (ch) => TR_TO_ASCII[ch] ?? ch)
    .trim();
}

/**
 * `needle` katlanmış hâliyle `haystack` içinde geçiyor mu?
 * Boş/whitespace arama TÜM kayıtları eşleştirir (süzgeç yok sayılır).
 */
export function foldedIncludes(haystack: string | null | undefined, needle: string): boolean {
  const q = foldSearchText(needle);
  if (q.length === 0) return true;
  return foldSearchText(haystack ?? "").includes(q);
}
