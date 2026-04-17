// =============================================================================
// TeksERP - Traveler Card Barcode Utilities
// =============================================================================
// Format:
//   cardNumber (insan okur): RK-YYMM-NNN          (örn: RK-2604-012)
//   barcode    (tarama):     RK-YYMM-XXXXXX-C     (örn: RK-2604-9F2K3P-7)
//
// XXXXXX — ay bazlı 6 karakterlik base32 (Crockford alphabet, I/L/O/U yok).
// C      — 1 karakterlik checksum, polinomik hash mod 31.
//
// Aynı ay içinde 32^6 = ~1.07 milyar farklı barkod üretilebilir.
// =============================================================================

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 32 chars
const BASE = CROCKFORD_ALPHABET.length;

/** Sayıyı Crockford base32 ile zero-padded string'e encode eder. */
export function encodeCrockford(num: number, length: number): string {
  if (num < 0 || !Number.isInteger(num)) {
    throw new Error("encodeCrockford: non-negative integer bekleniyor");
  }
  let n = num;
  const chars: string[] = [];
  while (n > 0) {
    chars.unshift(CROCKFORD_ALPHABET[n % BASE]);
    n = Math.floor(n / BASE);
  }
  while (chars.length < length) chars.unshift("0");
  if (chars.length > length) {
    throw new Error(`encodeCrockford: sayı ${length} karaktere sığmıyor`);
  }
  return chars.join("");
}

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
  return CROCKFORD_ALPHABET[sum];
}

/**
 * Verilen barkodun checksum'ını doğrular.
 * Format: RK-YYMM-XXXXXX-C
 */
export function verifyBarcode(barcode: string): boolean {
  const match = /^RK-(\d{4})-([0-9A-Z]{6})-([0-9A-Z])$/.exec(barcode.toUpperCase());
  if (!match) return false;
  const [, yymm, seq, check] = match;
  const expected = computeChecksum(`RK${yymm}${seq}`);
  return expected === check;
}

/**
 * Tam barkod üretir: RK-YYMM-XXXXXX-C
 * `monthlySequence` çağıran tarafından unique üretilmeli (DB aracılığıyla).
 */
export function buildBarcode(date: Date, monthlySequence: number): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yymm = `${yy}${mm}`;
  const seq = encodeCrockford(monthlySequence, 6);
  const body = `RK${yymm}${seq}`;
  const check = computeChecksum(body);
  return `RK-${yymm}-${seq}-${check}`;
}

/**
 * Human-readable kart numarası: RK-YYMM-NNN
 */
export function buildCardNumber(date: Date, monthlySequence: number): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `RK-${yy}${mm}-${String(monthlySequence).padStart(3, "0")}`;
}

/**
 * Generic prefix + YYMM + sequence formatında tarama barkodu
 * (traveler card ile aynı checksum yaklaşımı).
 * Örnekler:
 *   - SW (Swatch/Kartela): SW-YYMM-XXXXXX-C
 *   - SD (Fason Sevk):     SD-YYMM-XXXXXX-C (belge numarası olarak da kullanılır)
 *   - SR (Fason Kabul):    SR-YYMM-XXXXXX-C
 *   - RL (Roll/Top):       RL-YYMM-XXXXXX-C
 */
export function buildPrefixedBarcode(
  prefix: string,
  date: Date,
  monthlySequence: number
): string {
  if (!/^[A-Z]{2,3}$/.test(prefix)) {
    throw new Error("buildPrefixedBarcode: prefix 2-3 büyük harf olmalı");
  }
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yymm = `${yy}${mm}`;
  const seq = encodeCrockford(monthlySequence, 6);
  const body = `${prefix}${yymm}${seq}`;
  const check = computeChecksum(body);
  return `${prefix}-${yymm}-${seq}-${check}`;
}

/**
 * Human-readable kart/belge numarası: PREFIX-YYMM-NNNNNN
 */
export function buildPrefixedCardNumber(
  prefix: string,
  date: Date,
  monthlySequence: number,
  digits = 6
): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${prefix}-${yy}${mm}-${String(monthlySequence).padStart(digits, "0")}`;
}

/** Generic verify: prefix ile checksum doğrulaması */
export function verifyPrefixedBarcode(prefix: string, barcode: string): boolean {
  const re = new RegExp(`^${prefix}-(\\d{4})-([0-9A-Z]{6})-([0-9A-Z])$`);
  const m = re.exec(barcode.toUpperCase());
  if (!m) return false;
  const [, yymm, seq, check] = m;
  return computeChecksum(`${prefix}${yymm}${seq}`) === check;
}
