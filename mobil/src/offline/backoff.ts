// =============================================================================
// fullJitterBackoff — üstel geri çekilme + tam jitter (AWS full-jitter deseni).
// =============================================================================
// Neden: vardiya başında onlarca tablet aynı anda aynı hatayı alır; jitter'sız
// üstel backoff hepsini AYNI saniyede yeniden denetir (thundering herd) —
// zaten zorlanan sunucuya senkron istek dalgaları vurur. Çarpan [0.7, 1.3]
// dalgayı ~±%30 dağıtır; ortalama bekleme değişmez.

/** attempt: 0-tabanlı deneme sayısı (TanStack retryDelay'in failureCount'u). */
export function fullJitterBackoff(
  attempt: number,
  baseMs = 1000,
  capMs = 30_000,
): number {
  const exp = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}
