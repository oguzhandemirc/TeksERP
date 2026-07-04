// =============================================================================
// Kilit store'u + aktivite izleyicisi (idle auto-lock)
// =============================================================================
// `locked` = kilit ekranı görünür mü. Yalnız bu reaktif alandır (zustand);
// son-aktivite zaman damgası REAKTİF DEĞİL — her dokunuşta set() ile abone
// re-render'ı tetiklememek için modül-yerel mutable tutulur (60fps dokunmada
// ucuz). `useIdleLock` interval'i getLastActivity() okur, kararı idleLock.ts
// saf reducer'ı verir.
// =============================================================================

import { create } from 'zustand';

interface LockState {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

export const useLockStore = create<LockState>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => {
    recordActivity();
    set({ locked: false });
  },
}));

// --- Reaktif olmayan aktivite zaman damgası ----------------------------------
let lastActivityTs = Date.now();

/** Dokunma/etkileşim anında çağrılır (kök responder-capture). Ucuz, re-render yok. */
export function recordActivity(): void {
  lastActivityTs = Date.now();
}

/** Idle reducer'ı için son aktivite zamanı (epoch ms). */
export function getLastActivity(): number {
  return lastActivityTs;
}
