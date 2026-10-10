// Tel → ekran çevirisi: donmuş hedef/pay, sebep bekleyen duruş, izlenmeyen tezgah,
// ölçülmeyen alanın null kalması (uydurma yok) ve gün kırılımının birleşmesi.
import { describe, expect, it } from "vitest";
import { fromApi } from "./fromApi";
import { escalationTierOf, summarizeFloor } from "./metrics";
import { statusOf } from "./palette";
import type { LoomFloorDto, WireLoom } from "./service";

const T0 = "2026-10-10T08:00:00.000Z";
const AS_OF = "2026-10-10T08:30:00.000Z";
const MIN = 60_000;

function loom(over: Partial<WireLoom>): WireLoom {
  return {
    id: "m1",
    code: "01",
    name: "Tezgah 01",
    hallId: "h1",
    hallName: "Dokuma Holü",
    monitoringState: "LIVE",
    state: "RUNNING",
    openStop: null,
    today: { potSec: 3600, aptSec: 2700, availabilityPct: 75, stopCount: 0, breakdown: [] },
    targetUnitsPerMin: 600,
    job: null,
    recentStops: [],
    source: "OPERATOR",
    ...over,
  };
}

function dto(looms: WireLoom[]): LoomFloorDto {
  const counts = { total: 0, monitored: 0, running: 0, stopped: 0, unmonitored: 0, overdue: 0, stoppedByClass: { UNPLANNED: 0, SETUP: 0, PLANNED: 0, NON_SCHEDULED: 0, UNCLASSIFIED: 0 }, nowPct: null, todayPct: null };
  return {
    asOf: AS_OF,
    factoryDayStart: "2026-10-09T21:00:00.000Z",
    shift: { name: "1. vardiya", startsAt: "2026-10-10T05:00:00.000Z", endsAt: "2026-10-10T13:00:00.000Z" },
    graceMinutes: 0,
    dokumaEnabled: true,
    summary: counts,
    halls: [{ ...counts, hallId: "h1", hallName: "Dokuma Holü" }],
    looms,
  };
}

describe("fromApi", () => {
  it("⭐ açık duruşun hedef ve payı DONMUŞ değerden; kademe sunucu formülüyle aynı", () => {
    const f = fromApi(dto([loom({
      state: "STOPPED",
      openStop: { id: "s1", reasonCode: "ATKI_KOPUSU", reasonLabel: "Atkı kopuşu", lossClass: "UNPLANNED", startedAt: T0, targetMinutes: 20, graceMinutes: 5, tier: "OVERDUE", escalationDueAt: null, requiresReason: false, source: "OPERATOR" },
    })]));
    const s = f.looms[0]!.openStop!;
    expect(s).toMatchObject({ label: "Atkı kopuşu", lossClass: "UNPLANNED", targetMin: 20, graceMin: 5, attendant: null, notifiedAt: null });
    expect(escalationTierOf(s, Date.parse(T0) + 19 * MIN)).toBe("WITHIN");
    expect(escalationTierOf(s, Date.parse(T0) + 20 * MIN)).toBe("OVERDUE");
    expect(f.updatedAt).toBe(Date.parse(AS_OF));
    expect(f.shift?.name).toBe("1. vardiya");
  });

  it("sebep bekleyen duruş: ad 'Sebep bekleniyor', plansız gibi çizilir, hedefsiz", () => {
    const f = fromApi(dto([loom({
      state: "STOPPED",
      openStop: { id: "s1", reasonCode: null, reasonLabel: null, lossClass: null, startedAt: T0, targetMinutes: null, graceMinutes: 0, tier: "UNTRACKED", escalationDueAt: null, requiresReason: true, source: "MACHINE" },
    })]));
    const t = f.looms[0]!;
    expect(t.openStop?.label).toBe("Sebep bekleniyor");
    expect(statusOf(t)).toBe("UNPLANNED");
    expect(escalationTierOf(t.openStop!, Date.parse(AS_OF))).toBe("UNTRACKED");
  });

  it("⭐ izlenmeyen tezgah: açık duruşu yok, sayılara ve oranlara girmez", () => {
    const f = fromApi(dto([
      loom({ id: "a", state: "RUNNING" }),
      loom({ id: "b", code: "02", state: "UNMONITORED", monitoringState: "OFF", today: { potSec: 3600, aptSec: 0, availabilityPct: 0, stopCount: 0, breakdown: [] },
        openStop: { id: "s", reasonCode: "MOLA", reasonLabel: "Mola", lossClass: "PLANNED", startedAt: T0, targetMinutes: 30, graceMinutes: 0, tier: "WITHIN", escalationDueAt: null, requiresReason: false, source: "OPERATOR" } }),
    ]));
    const off = f.looms.find((t) => t.id === "b")!;
    expect(off.monitored).toBe(false);
    expect(off.openStop).toBeNull();
    expect(statusOf(off)).toBe("UNMONITORED");
    const s = summarizeFloor(f.looms, Date.parse(AS_OF));
    expect(s).toMatchObject({ total: 2, monitored: 1, running: 1, stopped: 0, unmonitored: 1, runningNowPct: 100, todayPct: 75 });
  });

  it("ölçülmeyen alanlar UYDURULMAZ: sayaç, devir, levent null; metre özeti null", () => {
    const f = fromApi(dto([loom({})]));
    const t = f.looms[0]!;
    expect(t.shift).toBeNull();
    expect(t.rpm).toBeNull();
    expect(t.beam).toBeNull();
    expect(t.targetRpm).toBe(600);
    expect(summarizeFloor(f.looms, Date.parse(AS_OF)).meters).toBeNull();
  });

  it("gün kırılımı sebep başına birleşir; geçmiş duruşlar olay listesine ad ile girer", () => {
    const f = fromApi(dto([loom({
      today: { potSec: 3600, aptSec: 3000, availabilityPct: 83, stopCount: 3, breakdown: [
        { reasonCode: "ATKI_KOPUSU", reasonLabel: "Atkı kopuşu", lossClass: "UNPLANNED", beamSlotNull: false, stopCount: 2, stopSec: 300 },
        { reasonCode: "ATKI_KOPUSU", reasonLabel: "Atkı kopuşu", lossClass: "UNPLANNED", beamSlotNull: true, stopCount: 1, stopSec: 120 },
        { reasonCode: "OZEL_X", reasonLabel: "Özel sebep", lossClass: "MINOR", beamSlotNull: true, stopCount: 1, stopSec: 60 },
      ] },
      recentStops: [{ id: "r1", reasonCode: "OZEL_X", lossClass: "MINOR", startedAt: T0, endedAt: "2026-10-10T08:01:00.000Z" }],
    })]));
    const t = f.looms[0]!;
    expect(t.dayBreakdown).toEqual([
      { reasonCode: "ATKI_KOPUSU", label: "Atkı kopuşu", lossClass: "UNPLANNED", count: 3, ms: 420_000 },
      { reasonCode: "OZEL_X", label: "Özel sebep", lossClass: "UNPLANNED", count: 1, ms: 60_000 },
    ]);
    expect(t.events.map((e) => [e.kind, e.label ?? null])).toEqual([["RUN", null], ["STOP", "Özel sebep"]]);
    expect(t.stops).toHaveLength(1);
  });

  it("dokuma işi: ad + renk birleşir, üretilen metre ölçülmez (null)", () => {
    const f = fromApi(dto([loom({ job: { weavingOrderNumber: "DK1010260001", itemName: "Poplin", colorName: "Lacivert", colorHex: "#223355", plannedM: 1200 } })]));
    expect(f.looms[0]!.job).toEqual({ no: "DK1010260001", fabric: "Poplin · Lacivert", color: "#223355", plannedM: 1200, producedM: null });
  });
});
