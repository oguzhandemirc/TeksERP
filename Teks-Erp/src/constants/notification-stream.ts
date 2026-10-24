// =============================================================================
// BİLDİRİM AKIŞ YOLLARI — sıkıştırma ve gecikme ölçümü istisnalarının TEK kaynağı (plan §3.9)
// =============================================================================
// SSE zili sıkıştırılırsa gzip tamponu `merhaba`yı tutar (tuzak 1); zil ve uzun yoklama gecikme
// ölçümüne girerse 25 sn+ "yavaş uç" olarak `EndpointLatencyDaily`yi kirletir (tuzak 3).
// =============================================================================
export const NOTIFICATION_BELL_PATH = "/api/bildirim/zil";
export const NOTIFICATION_WAIT_PATH = "/api/bildirim/bekle";

function pathOf(url: string | undefined): string {
  return (url ?? "").split("?")[0]!.replace(/\/+$/, "");
}

/** SSE zil akışı mı (sıkıştırma muafiyeti). */
export function isNotificationBellPath(url: string | undefined): boolean {
  return pathOf(url) === NOTIFICATION_BELL_PATH;
}

/** Bilerek uzun süren bağlantı mı (gecikme ölçümü muafiyeti). */
export function isLongLivedNotificationPath(url: string | undefined): boolean {
  const p = pathOf(url);
  return p === NOTIFICATION_BELL_PATH || p === NOTIFICATION_WAIT_PATH;
}
