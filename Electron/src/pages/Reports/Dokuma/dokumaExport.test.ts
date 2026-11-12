// =============================================================================
// BEKÇİ — DOKUMA RAPOR ÇIKTILARI: satır sayısı ekranla AYNI, iki değişmez çıktıda
// =============================================================================
// Kapsam: spec'in SATIR SAYISI girdi satırıyla birebir (çıktı sessizce kırpmaz)
// ve iki değişmez kâğıda geçer — ① kaynak kolonu ("ölçüldü mü elle mi") ②
// "ölçülemedi" beyanı sayıya çökmez. Bu ikisi düşerse çıktı EKRANDAN BAŞKA şey
// söyler ve bunu kimse fark etmez: dosya tek başına paylaşılır.
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildKarneExport } from "./dokumaExport";
import type { ShiftStatRow } from "./service";

const karneRow = (over: Partial<ShiftStatRow> = {}): ShiftStatRow => ({
  statId: "st1", machineId: "m1", machine: { code: "T-01", name: "Tezgah 1" }, shiftInstanceId: "s1",
  shiftInstance: { factoryDayKey: "2026-09-15", startsAt: "", endsAt: "", isCancelled: false, shiftDefinition: { code: "V1", name: "Sabah" } },
  live: false, sealState: "SEALED", sealGeneration: 2, sealedAt: "2026-09-15T14:00:00Z",
  terms: { calendarSec: 28800, potSec: 28000, aptSec: 26000, setupSec: 0, plannedDownSec: 0, unplannedDownSec: 2000, minorStopSec: 0, nonScheduledSec: 0, plannedBreakSec: 800, unclassifiedSec: 0, unitsActual: 9000, producedM: 400, targetUnitsPerMin: 20, source: "MACHINE", stopThresholdSec: 20 },
  kpis: { availabilityPct: 92.8, performancePct: null, effectivenessPct: null, formulaVersion: 1, olculemedi: { P: "hedef devir yok" }, warnings: [] },
  emptyLoom: false, warnings: ["x"], ...over,
});

describe("dokuma çıktı spec'leri", () => {
  it("④ Karne: satır sayısı listeyle aynı, mühür durumu ve kuşak kâğıda geçer", () => {
    const rows = [karneRow(), karneRow({ statId: null, sealState: "OPEN", live: true, sealGeneration: 0 })];
    const spec = buildKarneExport({ rows, periodLabel: "x", meta: { total: 2, live: 1, sealed: 1 } });
    const t = spec.tables[0]!;
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]!.durum).toBe("Mühürlü");
    expect(t.rows[1]!.durum).toBe("Anlık");
    expect(t.rows[0]!.kusak).toBe("2");
    expect(t.rows[1]!.kusak).toBe("");
    expect(String(t.rows[0]!.p)).toContain("ölçülemedi");
  });
});
