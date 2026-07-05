// -----------------------------------------------------------------------------
// Saf süre yardımcıları — DurationField'ın "hazır saat" preset'i + dakika etiketi
// tek kaynağı. React'ten bağımsız, birim-test edilir.
// -----------------------------------------------------------------------------

/**
 * "Hazır saat" preset'leri: 1..24 saat arası, ama yalnız `maxMinutes` sınırına
 * sığanlar (hours*60 <= maxMinutes). Örn. mobil kilit max 120 dk → [1, 2];
 * panel/saha idle max 1440 dk → [1..24]; oturum max 43200 dk → yine [1..24]
 * (üst sınır saat listesi 24'te durur). Saf fonksiyon.
 */
export function hoursPresetsUpTo(maxMinutes: number): number[] {
  const out: number[] = [];
  for (let h = 1; h <= 24; h++) {
    if (h * 60 <= maxMinutes) out.push(h);
  }
  return out;
}

/**
 * Dakikayı okunur Türkçe etikete çevirir:
 *  60 → "1 saat", 1440 → "24 saat", 45 → "45 dakika", 90 → "1 sa 30 dk".
 * Geçersiz/sıfır/negatif → "0 dakika". Saf fonksiyon.
 */
export function minutesToLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 dakika";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} dakika`;
  if (m === 0) return `${h} saat`;
  return `${h} sa ${m} dk`;
}
