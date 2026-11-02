// Cari düzenleme formunun sayı ayrıştırıcıları (boş ≠ sıfır) — `CariEditDialog.test.ts` kilitler.

/** Kolon tavanı `Decimal(14,2)` → tam kısım en fazla 12 hane. */
const RISK_LIMIT_INT_DIGITS = 12;

/**
 * "" → `null` (vadesiz) · "0" → `0` (peşin) · geçersiz → `undefined`.
 *
 * ⚠️ Üç durumlu dönüş bilinçli: `null` "temizle" komutudur ve backend'de gerçek
 * bir yazımdır; `undefined` ise "bu değer kabul edilemez" demektir ve isteği
 * hiç yollamamamız gerekir. İkisini tek `null`a indirmek, geçersiz girdiyi
 * sessizce "vadesiz"e çevirirdi.
 */
export function parseTermDays(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  // Yalnız rakam: "-5" · "3,5" · "1e3" · " 7 gün" hepsi elenir. `Number()` tek
  // başına bunların bir kısmını sessizce kabul ederdi.
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return undefined;
  return n;
}

/**
 * "" → `null` (limitsiz) · "50000" → "50000" · "50000,50" → "50000.50" ·
 * belirsiz/geçersiz → `undefined`.
 *
 * ⚠️ Binlik ayracı KABUL EDİLMEZ (dosya başlığı): "50.000" iki farklı sayıdır ve
 * hangisini kastettiğini yalnız kullanıcı bilir.
 */
export function parseRiskLimit(raw: string): string | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const intPart = m[1] as string;
  if (intPart.length > RISK_LIMIT_INT_DIGITS) return undefined;
  // Backend `decimalString` hem sayı hem string kabul eder; STRING gönderilir
  // ki JS float yuvarlaması (0.1+0.2 sınıfı) tutara hiç bulaşmasın.
  return m[2] ? `${intPart}.${m[2]}` : intPart;
}
