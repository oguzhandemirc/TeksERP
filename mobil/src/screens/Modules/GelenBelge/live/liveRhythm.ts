// Canlı okuma (L3) istek ritmi + otomatik çekim zamanlaması — saf. Kare ~4/sn gelir; sunucuya en çok ~1/sn gider ve
// uçuşta hep TEK istek vardır (yanıt/hata gelmeden yenisi çıkmaz). Bitiş: tüm alanlar kilitli + kamera sabit + net →
// "Kıpırdatmayın" halkası; koşul halka boyunca kesintisiz sürerse çekim.
import { LIVE_HOLD_MS, LIVE_MIN_SHARPNESS, LIVE_REQUEST_INTERVAL_MS } from './liveTuning';

export interface RhythmState {
  inFlight: boolean;
  lastSentAt: number | null;
}

export const IDLE_RHYTHM: RhythmState = { inFlight: false, lastSentAt: null };

/** Bu karede istek çıkabilir mi: uçuşta istek yok ve son gönderimden beri aralık doldu. */
export function canSend(s: RhythmState, now: number): boolean {
  if (s.inFlight) return false;
  return s.lastSentAt === null || now - s.lastSentAt >= LIVE_REQUEST_INTERVAL_MS;
}

export function markSent(_s: RhythmState, now: number): RhythmState {
  return { inFlight: true, lastSentAt: now };
}

/** Yanıt da hata da uçuşu bitirir (ağ hatasında bir sonraki karede yeniden denenir). */
export function markSettled(s: RhythmState): RhythmState {
  return { ...s, inFlight: false };
}

/** Otomatik çekim koşulu: tüm alanlar kilitli + kamera kıpırtısız + orta bölge yeterince net. */
export function readyToCapture(allLocked: boolean, stability: { still: boolean; sharpness: number } | null): boolean {
  return allLocked && !!stability && stability.still && stability.sharpness >= LIVE_MIN_SHARPNESS;
}

export interface HoldState {
  /** Halkanın başladığı an; null = halka yok. */
  since: number | null;
}

/** Halka adımı: koşul kopunca sıfırlanır; `progress` 0–1, `fire` = süre doldu (çağıran bir kez çeker). */
export function stepHold(h: HoldState, ready: boolean, now: number): { hold: HoldState; progress: number; fire: boolean } {
  if (!ready) return { hold: { since: null }, progress: 0, fire: false };
  const since = h.since ?? now;
  const progress = Math.min(1, (now - since) / LIVE_HOLD_MS);
  return { hold: { since }, progress, fire: progress >= 1 };
}
