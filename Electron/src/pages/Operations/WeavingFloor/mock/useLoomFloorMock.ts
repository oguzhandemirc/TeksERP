// =============================================================================
// useLoomFloorMock — Tezgah Salonu ÖNİZLEME verisi (yalnız geliştirme önizlemesi)
// =============================================================================
// Tohumlu üretici + istemci zamanlayıcısı; ağ/IPC YOK. Uygulamadaki ekran
// `useLoomFloorLive` (`GET /api/loom-floor`) okur; dönüş şekli ikisinde aynı.
// =============================================================================
import { useEffect, useState } from "react";
import { createFloor } from "./createFloor";
import { stepFloor } from "./stepFloor";
import type { FloorState } from "../types";

export interface LoomFloorMockOptions {
  seed?: number;
  /** Simülasyon adımı aralığı (ms). */
  stepMs?: number;
  /** Sayaçların akış aralığı (ms). */
  clockMs?: number;
}

export interface LoomFloorMock {
  floor: FloorState;
  /** Ekranın "şimdi"si — sayaçlar buna göre akar. */
  now: number;
  /** Veri örnek mi — ekran rozet basar. */
  sampleData: true;
}

export const DEFAULT_SEED = 20261009;

export function useLoomFloorMock(options: LoomFloorMockOptions = {}): LoomFloorMock {
  const { seed = DEFAULT_SEED, stepMs = 2_000, clockMs = 1_000 } = options;
  const [floor, setFloor] = useState<FloorState>(() => createFloor(seed, Date.now()));
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const step = window.setInterval(() => {
      const at = Date.now();
      // Vardiya bitince yeni vardiya taze salonla başlar (mock).
      setFloor((f) => (f.shift && at >= f.shift.endsAt ? createFloor(seed, at) : stepFloor(f, at)));
    }, stepMs);
    const clock = window.setInterval(() => setNow(Date.now()), clockMs);
    return () => {
      window.clearInterval(step);
      window.clearInterval(clock);
    };
  }, [seed, stepMs, clockMs]);

  return { floor, now, sampleData: true };
}
