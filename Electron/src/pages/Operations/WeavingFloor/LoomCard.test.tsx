// Kart levent rozeti: ilk bitecek leventin kalanı görünür, levent no ipucunda ve ekran okuyucu
// metninde; levent yoksa rozet yok (ölçülmeyen değer uydurulmaz).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoomCard } from "./LoomCard";
import type { LiveLoom } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z");

function loom(over: Partial<LiveLoom>): LiveLoom {
  return {
    id: "m1", code: "07", hall: "Hol A", monitored: true, loomType: null, targetRpm: null, rpm: null, picksPerCm: null,
    openStop: null, shift: null, today: { runSec: 2700, plannedSec: 3600 }, stops: [], dayBreakdown: [], events: [],
    job: null, beams: [], source: "OPERATOR", ...over,
  };
}

describe("LoomCard levent rozeti", () => {
  it("⭐ iki levent: rozet ilk biteceğin kalanını basar, +1 ve ikisinin numarası ipucunda", () => {
    render(<LoomCard loom={loom({ beams: [
      { no: "LV-1", slot: 1, warpSpec: "CK", totalM: 1000, remainingM: 900 },
      { no: "LV-2", slot: 2, warpSpec: "CK", totalM: 1000, remainingM: 40 },
    ] })} now={NOW} star={false} onSelect={() => undefined} />);
    const badge = screen.getByTestId("beam-badge");
    expect(badge.textContent).toBe("40 m+1");
    expect(badge.getAttribute("title")).toContain("Levent LV-1 (yuva 1): 900 m kaldı");
    expect(badge.getAttribute("title")).toContain("Levent LV-2 (yuva 2): 40 m kaldı");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("levent LV-2 40 m kaldı");
  });

  it("levent yoksa rozet çizilmez, ekran okuyucu metninde levent yok", () => {
    render(<LoomCard loom={loom({})} now={NOW} star={false} onSelect={() => undefined} />);
    expect(screen.queryByTestId("beam-badge")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toContain("levent");
  });
});
