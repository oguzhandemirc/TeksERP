// =============================================================================
// TEZGAH ALARMI — ses (WebAudio ile sentez; pakette ses dosyası yok, yeni paket yok)
// =============================================================================
// Kademe başına ayrı kısa ton: 1. kademe iki yumuşak bip, 2. kademe (patrona iletildi)
// üç inişli-çıkışlı bip. Ses çalınamazsa (WebAudio yok / cihaz yok) sessizce geçilir —
// şerit ve bildirim sesten bağımsız çalışır.
// =============================================================================

interface Beep {
  freq: number;
  at: number;
  dur: number;
}

/** Kademe tonu (saniye cinsinden zaman çizelgesi) — testte de okunur. */
export function alarmToneOf(tier: number): readonly Beep[] {
  if (tier >= 2) {
    return [
      { freq: 988, at: 0, dur: 0.16 },
      { freq: 740, at: 0.22, dur: 0.16 },
      { freq: 988, at: 0.44, dur: 0.28 },
    ];
  }
  return [
    { freq: 880, at: 0, dur: 0.14 },
    { freq: 880, at: 0.24, dur: 0.14 },
  ];
}

type AudioCtor = new () => AudioContext;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let shared: AudioContext | null = null;

/** Tonu çalar; çalındıysa true. `ctor` testte sahte bağlam vermek içindir. */
export function playAlarmTone(tier: number, ctor: AudioCtor | null = audioCtor()): boolean {
  if (!ctor) return false;
  try {
    shared ??= new ctor();
    const ctx = shared;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const t0 = ctx.currentTime + 0.02;
    for (const b of alarmToneOf(tier)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(b.freq, t0 + b.at);
      // Tık sesi olmasın: kısa yükseliş + üstel sönüm.
      gain.gain.setValueAtTime(0.0001, t0 + b.at);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + b.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + b.at + b.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + b.at);
      osc.stop(t0 + b.at + b.dur + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** Yalnız test: paylaşılan bağlamı unut. */
export function resetAlarmAudioForTest(): void {
  shared = null;
}
