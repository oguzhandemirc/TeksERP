// Salon TV alarm sesi: varsayılan KAPALI; açıkken yeni alarm/kademe bir kez çalar; kapalıyken
// görülen alarmlar işaretlenir (ses açıldığı an eski alarmlar toptan çalmaz).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { readTvSound, tvAlarmSignalsOf, useTvAlarmSound, writeTvSound } from "./tv-alarm-sound";
import type { LiveLoom } from "./types";

const loom = (id: string, alarmId: string | null, escalatedAt: number | null = null): LiveLoom =>
  ({ id, openStop: alarmId === null ? null : { alarmId, escalatedAt } }) as unknown as LiveLoom;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("TV alarm sesi", () => {
  it("⭐ varsayılan KAPALI; tercih bu bilgisayarda saklanır", () => {
    expect(readTvSound()).toBe(false);
    writeTvSound(true);
    expect(readTvSound()).toBe(true);
    writeTvSound(false);
    expect(readTvSound()).toBe(false);
  });

  it("anahtar: alarmlı duruş, kademe ESCALATED'dan", () => {
    expect(tvAlarmSignalsOf([loom("a", "x"), loom("b", null), loom("c", "y", 5)])).toEqual([
      { key: "x:k1", tier: 1 },
      { key: "y:k2", tier: 2 },
    ]);
  });

  it("⭐ kapalıyken çalmaz; açılınca eski alarm toptan çalmaz, yalnız YENİ kademe bir kez", () => {
    const play = vi.fn();
    const { rerender } = renderHook(({ looms, on }) => useTvAlarmSound(looms, on, play), {
      initialProps: { looms: [loom("a", "x")], on: false },
    });
    expect(play).not.toHaveBeenCalled();
    rerender({ looms: [loom("a", "x")], on: true });
    expect(play).not.toHaveBeenCalled();
    rerender({ looms: [loom("a", "x", 1)], on: true });
    rerender({ looms: [loom("a", "x", 1)], on: true });
    expect(play.mock.calls).toEqual([[2]]);
  });
});
