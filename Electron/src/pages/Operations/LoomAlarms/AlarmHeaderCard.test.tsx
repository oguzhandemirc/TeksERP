// Alarm başlığı: duruşu bildiren / kapatan. Eski kayıt (null) "bilinmiyor" der, ad uydurulmaz;
// eski sunucu alanı göndermezse satır çizilmez; kapatan yalnız duruş kapandıysa.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AlarmHeaderCard } from "./AlarmHeaderCard";
import type { LoomAlarmItem } from "./types";

const NOW = Date.parse("2026-10-11T08:00:00Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

function alarm(stop: Partial<LoomAlarmItem["stop"]>): LoomAlarmItem {
  return {
    id: "a1", kind: "STOP_OVERDUE", state: "OPEN", tier: 1,
    machine: { id: "m1", code: "TZ-12", name: "TZ-12", hallId: "h1", hallName: "Hol A" },
    stop: { id: "s1", startedAt: iso(23), endedAt: null, reasonCode: "IP_ATLAMA", reasonLabel: "İp atlama", lossClass: "UNPLANNED", source: "OPERATOR", ...stop },
    targetMinutes: 10, graceMinutes: 10, k1DueAt: iso(13), k2DueAt: null,
    ackedBy: null, ackedAt: null, snoozedBy: null, snoozedUntil: null, closedAt: null, totalSec: null, overdueSec: null, cancelReason: null,
    createdAt: iso(13),
  };
}

const actors = () => screen.queryByTestId("alarm-stop-actors")?.textContent ?? null;

describe("AlarmHeaderCard — Bildiren / Kapatan", () => {
  it("⭐ açık duruş: bildirenin adı, kapatan yok", () => {
    render(<AlarmHeaderCard alarm={alarm({ openedBy: { id: "u1", name: "Ayşe" }, closedBy: null })} now={NOW} />);
    expect(actors()).toBe("Bildiren: Ayşe");
  });

  it("⭐ kapanmış duruş: bildiren + kapatan", () => {
    render(<AlarmHeaderCard alarm={alarm({ endedAt: iso(1), openedBy: { id: "u1", name: "Ayşe" }, closedBy: { id: "u2", name: "Mehmet" } })} now={NOW} />);
    expect(actors()).toBe("Bildiren: Ayşe · Kapatan: Mehmet");
  });

  it("⭐ eski kayıt / sinyal (null) → \"bilinmiyor\", ad uydurulmaz", () => {
    render(<AlarmHeaderCard alarm={alarm({ endedAt: iso(1), openedBy: null, closedBy: null })} now={NOW} />);
    expect(actors()).toBe("Bildiren: bilinmiyor · Kapatan: bilinmiyor");
  });

  it("eski sunucu (alan yok) → satır çizilmez", () => {
    render(<AlarmHeaderCard alarm={alarm({})} now={NOW} />);
    expect(actors()).toBeNull();
  });
});
