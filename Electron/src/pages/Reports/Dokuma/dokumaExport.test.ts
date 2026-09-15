// =============================================================================
// BEKÇİ — DOKUMA RAPOR ÇIKTILARI: satır sayısı ekranla AYNI, iki değişmez çıktıda
// =============================================================================
// Kapsam: spec'in SATIR SAYISI girdi satırıyla birebir (çıktı sessizce kırpmaz)
// ve iki değişmez kâğıda geçer — ① kaynak kolonu ("ölçüldü mü elle mi") ②
// "ölçülemedi" beyanı sayıya çökmez. Bu ikisi düşerse çıktı EKRANDAN BAŞKA şey
// söyler ve bunu kimse fark etmez: dosya tek başına paylaşılır.
// =============================================================================
import { describe, expect, it } from "vitest";
import { buildKarneExport, buildParetoExport, buildRandimanExport, buildVardiyaKarnesiExport } from "./dokumaExport";
import type { EfficiencyReport, ParetoReport, ShiftScorecardReport, ShiftStatRow, SourceBreakdownTable } from "./service";

const KIRILIM: SourceBreakdownTable = {
  MACHINE: { satir: 1, potSec: 0 }, OPERATOR: { satir: 1, potSec: 0 }, SUPERVISOR: { satir: 0, potSec: 0 },
  SIMULATED: { satir: 0, potSec: 0 }, INFERRED: { satir: 0, potSec: 0 },
};
const META = { ufuk: "2026-09-14", ufukOncesiSatir: 0, total: 2, truncated: false, live: 1, sealed: 1 };

const satir = (over: Partial<EfficiencyReport["satirlar"][number]> = {}): EfficiencyReport["satirlar"][number] => ({
  machineId: "m1", machine: { code: "T-01", name: "Tezgah 1" },
  shiftInstanceId: "s1", factoryDayKey: "2026-09-15", shift: { code: "V1", name: "Vardiya 1" },
  live: false, sealState: "SEALED", source: "MACHINE", emptyLoom: false,
  potSec: 3600, aptSec: 3000, unitsActual: 1000, producedM: 120, targetUnitsPerMin: 20,
  availabilityPct: 83.3, performancePct: null, effectivenessPct: null,
  olculemedi: { P: "hedef devir yok" }, warnings: [], ...over,
});

const karneRow = (over: Partial<ShiftStatRow> = {}): ShiftStatRow => ({
  statId: "st1", machineId: "m1", machine: { code: "T-01", name: "Tezgah 1" }, shiftInstanceId: "s1",
  shiftInstance: { factoryDayKey: "2026-09-15", startsAt: "", endsAt: "", isCancelled: false, shiftDefinition: { code: "V1", name: "Sabah" } },
  live: false, sealState: "SEALED", sealGeneration: 2, sealedAt: "2026-09-15T14:00:00Z",
  terms: { calendarSec: 28800, potSec: 28000, aptSec: 26000, setupSec: 0, plannedDownSec: 0, unplannedDownSec: 2000, minorStopSec: 0, nonScheduledSec: 0, plannedBreakSec: 800, unclassifiedSec: 0, unitsActual: 9000, producedM: 400, targetUnitsPerMin: 20, source: "MACHINE", stopThresholdSec: 20 },
  kpis: { availabilityPct: 92.8, performancePct: null, effectivenessPct: null, formulaVersion: 1, olculemedi: { P: "hedef devir yok" }, warnings: [] },
  emptyLoom: false, warnings: ["x"], ...over,
});

describe("dokuma çıktı spec'leri", () => {
  it("① Randıman: satır sayısı girdiyle aynı, kaynak kolonu ve 'ölçülemedi' kâğıda geçer", () => {
    const rapor: EfficiencyReport = {
      satirlar: [satir(), satir({ machineId: "m2", source: "OPERATOR", emptyLoom: false })],
      toplam: { availabilityPct: 83.3, performancePct: null, effectivenessPct: null, olculemedi: { A: 0, P: 2, E: 2 }, rowCount: 2 },
      kaynakKirilimi: KIRILIM, meta: META,
    };
    const spec = buildRandimanExport({ rapor, periodLabel: "2026-09-09 – 2026-09-15 (fabrika günü)" });
    const t = spec.tables[0]!;
    expect(t.rows).toHaveLength(rapor.satirlar.length);
    expect(t.columns.map((c) => c.header)).toContain("Kaynak");
    expect(t.rows[0]!.kaynak).toBe("Ölçülen");
    expect(t.rows[1]!.kaynak).toBe("Elle (operatör)");
    // "ölçülemedi" METİN kalır: sayıya çevrilseydi sıfır randımanla aynı görünürdü.
    expect(String(t.rows[0]!.p)).toContain("ölçülemedi");
    expect(spec.subtitle).toContain("2026-09-09");
  });

  it("① Randıman: boş tezgah satırı kaynağını 'Boş tezgah' der", () => {
    const rapor: EfficiencyReport = {
      satirlar: [satir({ emptyLoom: true, source: "INFERRED" })],
      toplam: { availabilityPct: null, performancePct: null, effectivenessPct: null, olculemedi: { A: 1, P: 1, E: 1 }, rowCount: 1 },
      kaynakKirilimi: KIRILIM, meta: META,
    };
    expect(buildRandimanExport({ rapor, periodLabel: "x" }).tables[0]!.rows[0]!.kaynak).toBe("Boş tezgah");
  });

  it("② Pareto: sebep satırları + AYRI kovalar tablosu (kesişen kova toplama eklenmez)", () => {
    const rapor: ParetoReport = {
      sebepler: [
        { reasonCode: "TEL_KOPTU", reasonLabel: "Tel koptu", lossClass: "UNPLANNED", stopCount: 3, stopSec: 900 },
        { reasonCode: "AYAR", reasonLabel: null, lossClass: "SETUP", stopCount: 1, stopSec: 600 },
      ],
      mikroDuruslar: { stopCount: 12, stopSec: 120 },
      siniflandirilmamis: { stopCount: 2, stopSec: 300 },
      atanmamis: { stopCount: 1, stopSec: 60 },
      toplam: { stopCount: 18, stopSec: 1320 },
      kaynakKirilimi: KIRILIM, meta: META,
    };
    const spec = buildParetoExport({ rapor, periodLabel: "x" });
    expect(spec.tables[0]!.rows).toHaveLength(2);
    expect(spec.tables[0]!.rows[1]!.sebep).toBe("AYAR"); // etiket yoksa KOD basılır, boş bırakılmaz
    expect(spec.tables[1]!.rows.map((r) => r.kova)).toEqual(["Mikro duruşlar", "Sınıflandırılmamış", "Yuvası atanmamış", "TOPLAM"]);
    expect(String(spec.tables[1]!.notes?.join(" "))).toContain("ikinci kez EKLENMEZ");
  });

  it("③ Vardiya Karnesi: her vardiya AYRI sayfa, satırları makine sayısı kadar", () => {
    const rapor: ShiftScorecardReport = {
      vardiyalar: [
        {
          shiftInstanceId: "s1", shiftDefinitionId: "d1", shift: { code: "V1", name: "Sabah" }, startsAt: "2026-09-15T05:00:00Z", endsAt: "2026-09-15T13:00:00Z",
          isCancelled: false, uretim: { unitsActual: 5000, producedM: 300 }, durusSec: 1200, kaynakKirilimi: KIRILIM,
          ozet: { olculen: 1, elle: 1, simule: 0, cikarim: 0, olculemedi: 1, toplamSatir: 2 },
          makineler: [
            { machineId: "m1", machine: { code: "T-01", name: "Tezgah 1" }, source: "MACHINE", live: false, sealState: "SEALED", unitsActual: 3000, producedM: 180, durusSec: 600, emptyLoom: false, availabilityPct: 90, performancePct: 80, effectivenessPct: 72, olculemedi: {} },
            { machineId: "m2", machine: { code: "T-02", name: "Tezgah 2" }, source: "OPERATOR", live: true, sealState: "OPEN", unitsActual: 2000, producedM: null, durusSec: 600, emptyLoom: false, availabilityPct: null, performancePct: null, effectivenessPct: null, olculemedi: { A: "planlı süre yok" } },
          ],
        },
      ],
      meta: META,
    };
    const spec = buildVardiyaKarnesiExport({ rapor, day: "2026-09-15" });
    expect(spec.tables).toHaveLength(1);
    expect(spec.tables[0]!.rows).toHaveLength(2);
    expect(spec.tables[0]!.rows[1]!.metre).toBe("—"); // ölçülmemiş metre sıfıra çevrilmez
    expect(String(spec.tables[0]!.notes?.join(" "))).toContain("1 elle girildi");
    expect(spec.subtitle).toContain("2026-09-15");
  });

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
