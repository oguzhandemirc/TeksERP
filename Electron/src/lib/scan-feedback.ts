/**
 * Okutma sesli geri bildirimi — paket yok, Web Audio ile üretilen kısa tonlar.
 * Saha kuralı: operatör ekrana bakmadan okutur; başarı/red KULAKLA ayırt
 * edilmeli (yüksek kısa bip = tamam, düşük çift bip = red). AudioContext
 * yoksa (test/jsdom, kısıtlı ortam) sessizce no-op.
 */

let ctx: AudioContext | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    // Kullanıcı etkileşimi öncesi suspended kalabilir — okutma zaten etkileşimdir.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqHz: number, durationMs: number, startOffsetMs = 0, volume = 0.08) {
  const ac = audioCtx();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + startOffsetMs / 1000;
  const t1 = t0 + durationMs / 1000;
  osc.type = "square";
  osc.frequency.value = freqHz;
  // Klik önleme: hızlı fade-in/out zarfı.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
  gain.gain.setValueAtTime(volume, t1 - 0.01);
  gain.gain.linearRampToValueAtTime(0, t1);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t1);
}

/** Başarılı okutma — kısa, yüksek tek bip. */
export function beepOk() {
  tone(1320, 90);
}

/** Reddedilen/çözülemeyen okutma — düşük, çift bip (kulakla net ayrışır). */
export function beepError() {
  tone(220, 140);
  tone(220, 140, 190);
}
