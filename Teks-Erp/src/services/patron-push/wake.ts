// İstek yolu ↔ iş turu arasındaki tek dürtme kanalı: servis turu ÇAĞIRMAZ (bulut isteği istek yolunda olmaz), yalnız
// "yakında koş" der; dinleyiciyi `jobs/patron-push.job.ts` kurar. Dinleyici yoksa (iş kapalı, bekçi) no-op.
let listener: (() => void) | null = null;

export function setPatronPushWakeListener(fn: (() => void) | null): void {
  listener = fn;
}

export function requestPatronPushRound(): void {
  listener?.();
}
