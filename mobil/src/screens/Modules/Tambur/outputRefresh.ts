// "Çıkan etiketler" elle yenileme (kullanıcı 2026-11-11): ↻ en az bir tam tur döner, sonuç tostla söylenir.
// 15 sn'lik arka plan yoklaması bunları KULLANMAZ (sessiz). Saf — zaman ve hata dışarıdan verilir.

/** Bir tam tur süresi; yenileme erken bitse de dönüş bundan kısa kesilmez. */
export const REFRESH_MIN_SPIN_MS = 800;

/** Yenileme bittikten sonra dönüşün daha ne kadar süreceği (ms); tur tamamlandıysa 0. */
export function remainingSpinMs(startedAt: number, now: number, minMs = REFRESH_MIN_SPIN_MS): number {
  return Math.max(0, minMs - Math.max(0, now - startedAt));
}

const REASON_MAX = 60;

/** Hata → tek satırlık kısa neden. */
export function shortRefreshReason(err: unknown): string {
  const m = (err as { message?: unknown } | null)?.message;
  const raw = typeof m === 'string' ? m.trim() : '';
  if (!raw) return 'bilinmeyen hata';
  if (/network|timeout|zaman aşımı/i.test(raw)) return 'bağlantı yok';
  return raw.length > REASON_MAX ? `${raw.slice(0, REASON_MAX - 1)}…` : raw;
}

/** Elle yenilemenin tostu. */
export function manualRefreshToast(err: unknown | null): { type: 'success' | 'error'; text1: string } {
  if (err == null) return { type: 'success', text1: 'Çıkan etiketler yenilendi' };
  return { type: 'error', text1: `Yenilenemedi: ${shortRefreshReason(err)}` };
}
