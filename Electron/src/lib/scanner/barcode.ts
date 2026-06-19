// =============================================================================
// Barkod checksum doğrulaması — renderer aynası
// =============================================================================
// `Teks-Erp/src/utils/barcode.ts`'deki SAF (Date'siz, DB'siz) checksum
// fonksiyonlarının birebir kopyası. Renderer backend'i process/paket sınırı
// ötesinden import edemez; bu yüzden mirror'lanır. Yalnızca HIZLI YEREL UX için
// kullanılır (okunan kod yanlış mı yazılmış uyarısı). Tek doğruluk kaynağı
// backend'dir — submit asla bu yüzden engellenmez (API 400 karar verir).
// Parite `barcode.test.ts` ile kilitlenir.
// =============================================================================

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 char, I/L/O/U yok

/**
 * Verilen string için tek karakterlik deterministik checksum.
 * Tek-karakter OCR hatalarını ve bitişik transpozisyonları yakalar.
 */
export function computeChecksum(input: string): string {
  let sum = 0;
  const clean = input.replace(/-/g, "").toUpperCase();
  for (const ch of clean) {
    const v = CROCKFORD_ALPHABET.indexOf(ch);
    if (v < 0) continue; // '-' ve bilinmeyen karakterler atlanır
    sum = (sum * 3 + v) % 31;
  }
  return CROCKFORD_ALPHABET[sum]!;
}

/** Refakat kartı checksum doğrulaması. Format: RK-YYMM-XXXXXX-C */
export function verifyBarcode(barcode: string): boolean {
  const match = /^RK-(\d{4})-([0-9A-Z]{6})-([0-9A-Z])$/.exec(barcode.toUpperCase());
  if (!match) return false;
  const [, yymm, seq, check] = match;
  return computeChecksum(`RK${yymm}${seq}`) === check;
}

/** Generic prefix checksum doğrulaması: PREFIX-YYMM-XXXXXX-C (SW/SD/SR/KD/KR). */
export function verifyPrefixedBarcode(prefix: string, barcode: string): boolean {
  const re = new RegExp(`^${prefix}-(\\d{4})-([0-9A-Z]{6})-([0-9A-Z])$`);
  const m = re.exec(barcode.toUpperCase());
  if (!m) return false;
  const [, yymm, seq, check] = m;
  return computeChecksum(`${prefix}${yymm}${seq}`) === check;
}
