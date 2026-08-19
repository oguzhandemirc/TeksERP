// =============================================================================
// ARAMA KATLAMASI — Türkçe ↔ ASCII duyarsız metin eşleştirme (2026-08-19)
// =============================================================================
// Saha talebi: "canakkale" ile "çanakkale" AYNI sonucu vermeli. Sunucu
// aramalarında bu zaten çözülü (`buildTurkishSearch` terim varyantı üretir);
// bu dosya İSTEMCİDE bellekteki listeyi süzen yerler içindir (seçim modalları).
//
// ⚠️ Buradaki eksik SESSİZDİ: PickerModal `toLocaleLowerCase('tr')` yapıyordu —
// yani İ/ı doğru küçülüyordu ama ç/ğ/ş/ö/ü ASCII'ye İNMİYORDU. Operatör
// "canakkale" yazınca "ÇANAKKALE" bulunamıyor, liste boş görünüyor ve kayıt
// yokmuş sanılıyordu.
//
// ⚠️ Bu KARŞILAŞTIRMA katlamasıdır — depolanan değeri DEĞİŞTİRMEZ. Depolama
// kuralı ayrıdır ve BÜYÜK harftir (backend `normalizeDisplayName`).
//
// Electron'daki ikizi: `Electron/src/lib/search-fold.ts` (iki ayrı proje, ortak
// modül import edilemiyor — mobil `permissions.ts` ile aynı durum).
// =============================================================================

const TR_TO_ASCII: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

/** "ÇANAKKALE" · "çanakkale" · "Canakkale" → hepsi "canakkale". */
export function foldSearchText(value: string): string {
  return value
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşü]/g, (ch) => TR_TO_ASCII[ch] ?? ch)
    .trim();
}

/** Katlanmış eşleşme. Boş arama TÜM kayıtları eşleştirir (süzgeç yok sayılır). */
export function foldedIncludes(haystack: string | null | undefined, needle: string): boolean {
  const q = foldSearchText(needle);
  if (q.length === 0) return true;
  return foldSearchText(haystack ?? '').includes(q);
}
