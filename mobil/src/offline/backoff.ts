// =============================================================================
// jitteredBackoff — üstel geri çekilme + ±%30 bantlı jitter.
// =============================================================================
// Neden: vardiya başında onlarca tablet aynı anda aynı hatayı alır; jitter'sız
// üstel backoff hepsini AYNI saniyede yeniden denetir (thundering herd) —
// zaten zorlanan sunucuya senkron istek dalgaları vurur. Çarpan [0.7, 1.3]
// dalgayı ~±%30 dağıtır; ortalama bekleme değişmez. (AWS "full-jitter"
// rand[0, exp] kullanır — burada bilinçli olarak bantlı varyant seçildi:
// alt sınır korunur, ilk retry hiçbir zaman "anında" gelmez.)
// Efektif üst sınır: cap 30sn × 1.3 = 39sn.

/** attempt: 0-tabanlı deneme sayısı (TanStack retryDelay'in failureCount'u). */
export function jitteredBackoff(
  attempt: number,
  baseMs = 1000,
  capMs = 30_000,
): number {
  const exp = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.round(exp * (0.7 + Math.random() * 0.6));
}
