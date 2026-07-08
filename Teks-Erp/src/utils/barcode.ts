// =============================================================================
// TeksERP - Traveler Card Barcode Utilities
// =============================================================================
// Format:
//   cardNumber (insan okur): RK-YYMM-NNN          (örn: RK-2604-012) — tireli, taranmaz
//   barcode    (tarama):     RKYYMMXXXXXXC        (örn: RK26069F2K3P7) — AYRAÇSIZ
//
// XXXXXX — ay bazlı 6 karakterlik base32 (Crockford alphabet, I/L/O/U yok).
// C      — 1 karakterlik checksum, polinomik hash mod 31 (tire-bağımsız).
// Barkod ayraçsız: el tarayıcı klavye-taklidi Türkçe düzende `-`'yi `*`'a çeviriyordu.
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
 * Format: RKYYMMXXXXXXC (ayraçsız)
 */
export function verifyBarcode(barcode: string): boolean {
  // F31: Crockford sınıfı (I/L/O/U hariç) — encoder bunları asla üretmez; format
  // kapısında reddetmek O↔0/I↔1 yanlış-okumasını yakalar + 'bizden geldi' garantisi.
  const match = /^RK(\d{4})([0-9A-HJKMNP-TV-Z]{6})([0-9A-HJKMNP-TV-Z])$/.exec(barcode.toUpperCase());
  if (!match) return false;
  const [, yymm, seq, check] = match;
  const expected = computeChecksum(`RK${yymm}${seq}`);
  return expected === check;
}

/**
 * Tam barkod üretir: RKYYMMXXXXXXC (ayraçsız)
 * `monthlySequence` çağıran tarafından unique üretilmeli (DB aracılığıyla).
 */
export function buildBarcode(date: Date, monthlySequence: number): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yymm = `${yy}${mm}`;
  const seq = encodeCrockford(monthlySequence, 6);
  const body = `RK${yymm}${seq}`;
  const check = computeChecksum(body);
  return `${body}${check}`;
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
  return `${body}${check}`; // AYRAÇSIZ (SW tarama barkodu) — wedge klavye -→* fix
}

/**
 * Kart/belge numarası: PREFIX{sep}YYMM{sep}NNNNNN.
 * separator "-" (varsayılan) = insan-okur (SW kartela no); "" = ayraçsız taranan
 * belge no (SD/SR/KD/KR — belge no'nun kendisi okutuluyor, wedge -→* fix).
 */
export function buildPrefixedCardNumber(
  prefix: string,
  date: Date,
  monthlySequence: number,
  digits = 6,
  separator = "-",
): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${prefix}${separator}${yy}${mm}${separator}${String(monthlySequence).padStart(digits, "0")}`;
}

/** Generic verify: prefix ile checksum doğrulaması (ayraçsız PREFIXYYMMXXXXXXC) */
export function verifyPrefixedBarcode(prefix: string, barcode: string): boolean {
  // F31: prefix guard (regex-injection savunması + buildPrefixedBarcode simetrisi) +
  // Crockford sınıfı (I/L/O/U hariç).
  if (!/^[A-Z]{2,3}$/.test(prefix)) return false;
  const re = new RegExp(`^${prefix}(\\d{4})([0-9A-HJKMNP-TV-Z]{6})([0-9A-HJKMNP-TV-Z])$`);
  const m = re.exec(barcode.toUpperCase());
  if (!m) return false;
  const [, yymm, seq, check] = m;
  return computeChecksum(`${prefix}${yymm}${seq}`) === check;
}
