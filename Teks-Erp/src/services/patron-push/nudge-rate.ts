// Dürt hız bütçesi — köprü kurulum başına dakikada 120 dürt kabul eder (sözleşme §5, `KOPRU_DURT_DK`). Backend TEK
// süreç olduğu için süreç içi kayan pencere yeter; aşan satır kuyrukta BEKLER (sonraki tur). 429 gelirse bütçe bir
// süre sıfırlanır. Durum bellektedir: yeniden başlatmada pencere boşalır, bulutun tavanı son seddir (429 → bekle).
export const NUDGE_RATE_PER_MIN = 120;
const WINDOW_MS = 60_000;

const sentAt: number[] = [];
let pausedUntilMs = 0;

function prune(nowMs: number): void {
  while (sentAt.length > 0 && sentAt[0]! <= nowMs - WINDOW_MS) sentAt.shift();
}

/** Şu an gönderilebilecek dürt sayısı. */
export function nudgeBudget(nowMs: number): number {
  prune(nowMs);
  if (nowMs < pausedUntilMs) return 0;
  return Math.max(0, NUDGE_RATE_PER_MIN - sentAt.length);
}

export function noteNudgeSent(nowMs: number): void {
  sentAt.push(nowMs);
}

/** 429 `HIZ_SINIRI`: bulut söyleyene dek (ya da sabit süre) dürt yok. */
export function pauseNudges(untilMs: number): void {
  pausedUntilMs = Math.max(pausedUntilMs, untilMs);
}

/** Bekçi kancası: pencereyi ve duraklamayı sıfırlar. */
export function resetNudgeRate(): void {
  sentAt.length = 0;
  pausedUntilMs = 0;
}
