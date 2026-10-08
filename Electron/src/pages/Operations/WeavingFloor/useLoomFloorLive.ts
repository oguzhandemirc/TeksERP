// =============================================================================
// useLoomFloorLive — Tezgah Salonu'nun TEK veri kapısı
// =============================================================================
// Bugün yalnız MOCK: tohumlu üretici + istemci zamanlayıcısı; ağ/IPC YOK.
// Gerçek veriye geçişte yalnız bu dosyanın gövdesi değişir (sorgu + canlı akış);
// dönüş şekli (`FloorState` + `now` + `sampleData`) sabit kalır.
// =============================================================================
import { useEffect, useState } from "react";
import { createFloor } from "./mock/createFloor";
import { stepFloor } from "./mock/stepFloor";
import type { FloorState } from "./types";

export interface LoomFloorLiveOptions {
  seed?: number;
  /** Simülasyon adımı aralığı (ms). */
  stepMs?: number;
  /** Sayaçların akış aralığı (ms). */
  clockMs?: number;
}

export interface LoomFloorLive {
  floor: FloorState;
  /** Ekranın "şimdi"si — sayaçlar buna göre akar. */
  now: number;
  /** Veri örnek mi — ekran rozet basar. */
  sampleData: true;
}

export const DEFAULT_SEED = 20261009;

export function useLoomFloorLive(options: LoomFloorLiveOptions = {}): LoomFloorLive {
  const { seed = DEFAULT_SEED, stepMs = 2_000, clockMs = 1_000 } = options;
  const [floor, setFloor] = useState<FloorState>(() => createFloor(seed, Date.now()));
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const step = window.setInterval(() => {
      const at = Date.now();
      // Vardiya bitince yeni vardiya taze salonla başlar (mock).
      setFloor((f) => (at >= f.shift.endsAt ? createFloor(seed, at) : stepFloor(f, at)));
    }, stepMs);
    const clock = window.setInterval(() => setNow(Date.now()), clockMs);
    return () => {
      window.clearInterval(step);
      window.clearInterval(clock);
    };
  }, [seed, stepMs, clockMs]);

  return { floor, now, sampleData: true };
}
