// =============================================================================
// Geçici HTTP hatası sınıflandırması — TEK kaynak (api.ts interceptor'ı + yoklama + kuyruk retry)
// =============================================================================
// Barındırılan kurulumda (VDS: nginx / Cloudflare önde) backend yeniden başlarken ya da
// hat kesikken yanıtı backend DEĞİL vekil verir: 502/503/504, Cloudflare 520–530, gövdesi
// HTML. Bunu "sunucu cevap verdi" saymak kuyruk kaydını 3 denemede (5–9 sn) kalıcı
// düşürüyordu (denetim Y4). Ayrım gövdeden yapılır: backend'in HER yanıtı `success`
// alanlı JSON'dur; o zarf yoksa yanıt vekilindir = sunucuya ULAŞILAMADI.
//
//   'gateway'    → vekil 5xx: çevrimdışı yol (reportServerUnreachable), kayıt kuyrukta bekler.
//   'rate-limit' → 429: Retry-After'a uyulur, kayıt kuyrukta bekler.
//   'busy'       → backend'in KENDİ 503'ü (SERVER_BUSY / cihaz meşgul): sunucu ayakta, kayıt bekler.
//   null         → deterministik ya da backend'in kendi 5xx'i — bugünkü davranış.
// =============================================================================

export type TransientKind = 'gateway' | 'rate-limit' | 'busy';

/** Vekil/CDN'in kendi hata kodları — backend bunları üretmez. */
function isGatewayStatus(status: number): boolean {
  return status === 502 || status === 504 || (status >= 520 && status <= 530);
}

/** Backend zarfı: `{ success: boolean, ... }` JSON nesnesi. HTML/metin/boş gövde zarf değildir. */
export function hasBackendEnvelope(data: unknown): boolean {
  return !!data && typeof data === 'object' && !Array.isArray(data) && 'success' in data;
}

export function classifyHttpFailure(status: number | undefined, data: unknown): TransientKind | null {
  if (!status) return null;
  if (status === 429) return 'rate-limit';
  if (status < 500) return null;
  if (isGatewayStatus(status) || !hasBackendEnvelope(data)) return 'gateway';
  if (status === 503) return 'busy';
  return null;
}

/** Retry-After üst sınırı: sunucu absürt bir süre dese de kayıt makul aralıkla yeniden denenir. */
export const RETRY_AFTER_CAP_MS = 10 * 60_000;

/**
 * Bekleme süresi (ms): önce `Retry-After` başlığı (saniye ya da HTTP-tarihi), yoksa backend
 * gövdesindeki `details.retryAfterSec`. Çözülemezse null (çağıran üstel beklemeye düşer).
 */
export function parseRetryAfterMs(
  header: unknown,
  details: unknown,
  now: number = Date.now(),
): number | null {
  let ms: number | null = null;
  if (typeof header === 'string' && header.trim() !== '') {
    const sec = Number(header.trim());
    if (Number.isFinite(sec)) ms = sec * 1000;
    else {
      const at = Date.parse(header);
      if (Number.isFinite(at)) ms = at - now;
    }
  }
  if (ms === null) {
    const sec = Number((details as { retryAfterSec?: unknown } | null | undefined)?.retryAfterSec);
    if (Number.isFinite(sec) && sec > 0) ms = sec * 1000;
  }
  if (ms === null) return null;
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(1000, Math.round(ms)));
}
