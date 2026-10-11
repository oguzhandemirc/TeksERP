// Tezgah detayı: canlı alarmı olan duruşta "Alarm sayfasını aç" — yalnız çağıran bağlantı verdiyse
// (alarm bayrağı + `loom:alarm-view`, TV dışı); alarmsız duruşta düğme yok.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoomDetailSheet } from "./LoomDetailSheet";
import type { LiveLoom, OpenStop } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00Z");

function loom(stop: Partial<OpenStop>): LiveLoom {
  return {
    id: "m1", code: "12", hall: "Hol A", monitored: true, stateSource: "elle", loomType: null, targetRpm: null, rpm: null, picksPerCm: null,
    openStop: {
      reasonCode: "IP_ATLAMA", label: "İp atlama", lossClass: "UNPLANNED", startedAt: NOW - 23 * 60_000, targetMin: 10, graceMin: 0,
      attendant: null, notifiedAt: null, respondedAt: null, escalatedAt: NOW - 13 * 60_000, alarmId: "al-1", ...stop,
    },
    shift: null, today: { runSec: 0, plannedSec: 0 }, stops: [], dayBreakdown: null, events: [], job: null, beams: [], source: "OPERATOR",
  };
}

describe("LoomDetailSheet — alarm bağlantısı", () => {
  it("⭐ alarmlı duruş + bağlantı verildi → düğme alarm sayfasını açar", () => {
    const open = vi.fn();
    render(<LoomDetailSheet loom={loom({})} now={NOW} onClose={() => undefined} onOpenAlarm={open} />);
    expect(screen.getByText("Patrona iletildi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alarm sayfasını aç/ }));
    expect(open).toHaveBeenCalledWith("al-1");
  });

  it("bağlantı verilmedi (izin/bayrak yok ya da TV) → düğme yok", () => {
    render(<LoomDetailSheet loom={loom({})} now={NOW} onClose={() => undefined} />);
    expect(screen.queryByRole("button", { name: /Alarm sayfasını aç/ })).toBeNull();
  });

  it("alarmsız duruş → düğme yok", () => {
    render(<LoomDetailSheet loom={loom({ alarmId: null, escalatedAt: null })} now={NOW} onClose={() => undefined} onOpenAlarm={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Alarm sayfasını aç/ })).toBeNull();
  });
});
