// =============================================================================
// Dürtme BİRLEŞTİRİCİ — sondan birleştirme (debounce) + en çok bekleme tavanı
// =============================================================================
// Olay akışında (makine sinyali, toplu duruş) her yazım bir dürtme üretir; birleştirici bunları
// tek tura indirir: son dürtmeden `debounceMs` sonra çalar, ama ilk dürtmeden `maxWaitMs`ten geç
// kalmaz (kesintisiz akış motoru aç bırakmasın). Saat ve zamanlayıcı enjekte edilir (DB'siz bekçi).
// =============================================================================

export interface NudgeCoalescerOptions {
  debounceMs: number;
  maxWaitMs: number;
  fire: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface NudgeCoalescer {
  nudge: () => void;
  /** Bekleyen dürtme var mı (bekçi ve kapanış için). */
  pending: () => boolean;
  cancel: () => void;
}

/** Saf gecikme hesabı: sessizlik penceresi, ilk dürtmeden bu yana kalan tavanla kırpılır (negatif olmaz). */
export function nudgeDelayMs(nowMs: number, firstNudgeAtMs: number, debounceMs: number, maxWaitMs: number): number {
  const remainingCapMs = firstNudgeAtMs + maxWaitMs - nowMs;
  return Math.max(0, Math.min(debounceMs, remainingCapMs));
}

export function createNudgeCoalescer(o: NudgeCoalescerOptions): NudgeCoalescer {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let handle: unknown = null;
  let firstAt: number | null = null;

  const fireNow = (): void => {
    handle = null;
    firstAt = null;
    o.fire();
  };

  return {
    nudge() {
      const t = now();
      firstAt ??= t;
      if (handle !== null) clearTimer(handle);
      handle = setTimer(fireNow, nudgeDelayMs(t, firstAt, o.debounceMs, o.maxWaitMs));
    },
    pending: () => handle !== null,
    cancel() {
      if (handle !== null) clearTimer(handle);
      handle = null;
      firstAt = null;
    },
  };
}
