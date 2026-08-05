import { describe, expect, it } from "vitest";
import { buildTabs, POOL_TAB } from "./machine-tabs";
import type {
  KursunBypassMachineOption,
  KursunDistributionAssignedRow,
  KursunDistributionWaitingRow,
} from "./types";

const machine = (id: string, name: string): KursunBypassMachineOption => ({
  id,
  code: id,
  name,
  stationId: "st",
  stationName: "Kurşun + KK2",
});

const base = {
  workOrderId: "wo",
  workOrderNumber: "IE-1",
  batchNumbers: [],
  travelerCardNumber: null,
  travelerCardBarcode: null,
  itemName: null,
  colorName: null,
  colorHex: null,
  openRollCount: 1,
  oldestEnteredAt: null,
  isUrgent: false,
  urgentMarkedAt: null,
  isLastStep: false,
};

const waiting = (id: string, meters: number): KursunDistributionWaitingRow => ({
  ...base,
  workOrderStepId: id,
  totalMeters: meters,
  eligible: true,
  blockReason: null,
});

const assigned = (
  id: string,
  machineId: string,
  meters: number,
  over: Partial<KursunDistributionAssignedRow> = {},
): KursunDistributionAssignedRow => ({
  ...base,
  workOrderStepId: id,
  totalMeters: meters,
  priority: 0,
  assignmentId: `as-${id}`,
  machineId,
  machineCode: machineId,
  machineName: machineId === "m1" ? "Makine 1" : "Makine 2",
  stationId: "st",
  stationName: "Kurşun + KK2",
  assignedAt: "2026-08-05T10:00:00.000Z",
  assignedByName: null,
  notes: null,
  stale: false,
  staleReason: null,
  ...over,
});

describe("buildTabs", () => {
  it("ilk sekme HAVUZ'dur ve bekleyenleri sayar", () => {
    const tabs = buildTabs([], [waiting("w1", 100), waiting("w2", 250)], []);
    expect(tabs[0]).toMatchObject({ key: POOL_TAB, label: "Havuz", count: 2, meters: 350 });
  });

  it("İŞİ OLMAYAN makinenin de sekmesi vardır", () => {
    // "Makine 2 boş mu, yoksa sekmesi mi yok?" sorusu operatörü durdurur; ayrıca
    // boş makine tam da iş verilecek yerdir.
    const tabs = buildTabs([machine("m1", "Makine 1"), machine("m2", "Makine 2")], [], []);
    expect(tabs.map((t) => t.key)).toEqual([POOL_TAB, "m1", "m2"]);
    expect(tabs[2]).toMatchObject({ count: 0, meters: 0 });
  });

  it("makine sekmesi kendi satırlarını sayar, diğerininkini DEĞİL", () => {
    const tabs = buildTabs(
      [machine("m1", "Makine 1"), machine("m2", "Makine 2")],
      [],
      [assigned("a1", "m1", 100), assigned("a2", "m1", 200), assigned("b1", "m2", 50)],
    );
    expect(tabs[1]).toMatchObject({ key: "m1", count: 2, meters: 300 });
    expect(tabs[2]).toMatchObject({ key: "m2", count: 1, meters: 50 });
  });

  it("bayat dağıtım sayısı sekmede rozetlenir", () => {
    const tabs = buildTabs(
      [machine("m1", "Makine 1")],
      [],
      [assigned("a1", "m1", 100, { stale: true }), assigned("a2", "m1", 100)],
    );
    expect(tabs[1]).toMatchObject({ staleCount: 1 });
  });

  it("PASİFLEŞMİŞ makinedeki açık işler için de sekme üretilir", () => {
    // Makine artık atama hedefi değil (listede yok) ama üstünde açık iş var.
    // Sekme olmazsa o işlere ulaşılamaz ve havuza döndürülemezlerdi.
    const tabs = buildTabs([machine("m1", "Makine 1")], [], [assigned("z1", "m9", 400)]);
    const orphan = tabs.find((t) => t.key === "m9");
    expect(orphan).toBeDefined();
    expect(orphan!.label).toContain("(pasif)");
    expect(orphan!.count).toBe(1);
  });

  it("pasif makine sekmesi TEK KEZ üretilir (satır başına değil)", () => {
    const tabs = buildTabs([], [], [assigned("z1", "m9", 100), assigned("z2", "m9", 100)]);
    expect(tabs.filter((t) => t.key === "m9")).toHaveLength(1);
    expect(tabs.find((t) => t.key === "m9")!.count).toBe(2);
  });
});
