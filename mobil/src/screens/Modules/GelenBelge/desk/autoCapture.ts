// Belge masası OTOMATİK çekim (K26, deneysel, PAKETSİZ) — saf karar fonksiyonu.
// expo-camera 17 piksel vermez: ara kare düşük kaliteli JPEG'dir ve tek sinyal BAYT BOYUDUR (baskılı kağıt boş masadan
// belirgin farklı sıkışır). Boş masa referansı + art arda karelerin kararlılığı (hareket durdu) → tam çözünürlük çekim.
export interface AutoCaptureConfig {
  /** Kare boyu referanstan bu oranda saparsa masada kağıt var. */
  presenceRatio: number;
  /** Son `stableFrames` kare arasında (max−min)/max bu oranın altındaysa sahne sabit. */
  stableRatio: number;
  stableFrames: number;
  /** Sonraki sayfa: son çekilen kareden bu oranda farklı sabit sahne. */
  changeRatio: number;
}

export const AUTO_CAPTURE_DEFAULTS: AutoCaptureConfig = { presenceRatio: 0.15, stableRatio: 0.04, stableFrames: 3, changeRatio: 0.12 };

export interface AutoCaptureState {
  /** Boş masa kare boyu; null = referans henüz alınmadı. */
  baseline: number | null;
  recent: number[];
  /** Çekime hazır mı (çekimden sonra sahne değişene kadar kapalı). */
  armed: boolean;
  lastCaptured: number | null;
}

export type AutoAction = 'wait' | 'capture' | 'calibrated';

export interface AutoDecision {
  action: AutoAction;
  hint: string;
  state: AutoCaptureState;
  /** Masa sabit ve boş (boşta duraklatma sayacı yalnız bunda ilerler). */
  idle?: boolean;
}

export const initialAutoState = (): AutoCaptureState => ({ baseline: null, recent: [], armed: true, lastCaptured: null });

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
const differs = (a: number, b: number, ratio: number): boolean => Math.abs(a - b) / Math.max(b, 1) > ratio;

function isStable(recent: readonly number[], cfg: AutoCaptureConfig): boolean {
  if (recent.length < cfg.stableFrames) return false;
  const max = Math.max(...recent);
  return max > 0 && (max - Math.min(...recent)) / max <= cfg.stableRatio;
}

/** Bir ara kare boyu → karar. Durum değişmez nesne olarak döner (hook yalnız saklar). */
export function stepAutoCapture(prev: AutoCaptureState, frameSize: number, cfg: AutoCaptureConfig = AUTO_CAPTURE_DEFAULTS): AutoDecision {
  const recent = [...prev.recent, frameSize].slice(-cfg.stableFrames);
  const s: AutoCaptureState = { ...prev, recent };
  const stable = isStable(recent, cfg);
  if (s.baseline === null) {
    if (!stable) return { action: 'wait', hint: CALIBRATING_HINT, state: s };
    return { action: 'calibrated', hint: 'Boş masa kaydedildi — kağıdı koyun', state: { ...s, baseline: mean(recent) } };
  }
  if (!stable) return { action: 'wait', hint: 'Hareket var — kağıt durunca çekilecek', state: s };
  const level = mean(recent);
  const present = differs(level, s.baseline, cfg.presenceRatio);
  const capture = (): AutoDecision => ({ action: 'capture', hint: 'Çekiliyor…', state: { ...s, armed: false, lastCaptured: level } });
  if (s.armed) return present ? capture() : { action: 'wait', hint: 'Kağıt bekleniyor', state: s, idle: true };
  if (!present) return { action: 'wait', hint: 'Masa boş — sonraki kağıdı koyun', state: { ...s, armed: true, lastCaptured: null }, idle: true };
  // Önceki sayfa kaldırılmadan üstüne yeni sayfa kondu: sabit sahne öncekinden belirgin farklıysa yeni sayfadır.
  if (s.lastCaptured !== null && differs(level, s.lastCaptured, cfg.changeRatio)) return capture();
  return { action: 'wait', hint: 'Sayfa alındı — sonraki sayfayı koyun ya da Oku’ya basın', state: s };
}

/** Elle "Okut" (otomatik kipte de): SON kare çekildi sayılır (ortalama eski boş masa karesini taşıyabilir). */
export function afterManualCapture(s: AutoCaptureState): AutoCaptureState {
  const last = s.recent[s.recent.length - 1];
  return { ...s, armed: false, lastCaptured: last ?? s.lastCaptured };
}

/** "Tekrar çek": son sayfa silindi → masadaki kağıt sabitlenince yeniden çekilir. */
export function rearm(s: AutoCaptureState): AutoCaptureState {
  return { ...s, armed: true, lastCaptured: null, recent: [] };
}

/**
 * İnceleme sonrası kameraya dönüş: boş masa referansı ve "son çekilen" korunur (okunan kağıt masada dururken yeni
 * referans olmasın / yeniden çekilmesin); eski ara kareler kararlılık penceresine karışmasın diye atılır.
 */
export function resumeAutoState(s: AutoCaptureState): AutoCaptureState {
  return { ...s, recent: [] };
}

export const CALIBRATING_HINT = 'Boş masa referansı alınıyor — masayı boş bırakın';

export function resumeHint(s: AutoCaptureState): string {
  if (s.baseline === null) return CALIBRATING_HINT;
  return s.armed ? 'Kağıt bekleniyor' : 'Okunan kağıdı masadan kaldırın';
}
