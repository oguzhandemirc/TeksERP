// Devere F2 — denye sapma modeli: tek kolon kurucusu ekranla Excel/PDF'i aynı listeden besler; istemci hesap yapmaz.
import { describe, expect, it } from "vitest";
import { DENYE_COLUMNS, buildDenyeExport, denyeLines, suggestionText, type DenierReport } from "./denyeSapma";

const report: DenierReport = {
  range: { from: "2026-11-01", to: "2026-11-20" },
  settings: { minBeams: 3, thresholdPct: 2 },
  rows: [
    { yarnItemId: "y1", code: "PES70", name: "Polyester 70/800", beamCount: 5, lengthM: "5000.000", nominalKg: "500.000", weighedNetKg: "520.000",
      deviationPct: "4.00", copiedDenier: "70", weighedDenier: "72.80", cardDenier: "70", cardDeviationPct: "4.00", status: "SUGGEST", suggestedDenier: "72.80" },
    { yarnItemId: "y2", code: "PES50", name: "Polyester 50/600", beamCount: 2, lengthM: "2000.000", nominalKg: "180.000", weighedNetKg: "183.100",
      deviationPct: "1.72", copiedDenier: "50", weighedDenier: "50.86", cardDenier: "50", cardDeviationPct: "1.72", status: "INSUFFICIENT", suggestedDenier: null },
  ],
  mixed: { beamCount: 3, lengthM: "3000.000", nominalKg: "610.000", weighedNetKg: "642.000", deviationPct: "5.25", yarnItemIds: ["y1", "y3"] },
};

describe("denye sapma modeli", () => {
  it("satırlar: iplik satırları + sonda tek karma satırı", () => {
    const lines = denyeLines(report);
    expect(lines.map((l) => l.kind)).toEqual(["yarn", "yarn", "mixed"]);
    expect(denyeLines(undefined)).toEqual([]);
  });

  it("öneri metni sunucu durumundan: öneri · yetersiz (en az N levent) · karma", () => {
    const [a, b, m] = denyeLines(report);
    expect(suggestionText(a!, report.settings)).toBe("72,8 den");
    expect(suggestionText(b!, report.settings)).toBe("Yetersiz örnek (en az 3 levent)");
    expect(suggestionText(m!, report.settings)).toBe("Çok iplikli — öneri yok");
  });

  it("⭐ Excel/PDF kolonları ekran kolon listesinin AYNISI (tek kurucu), sayılar sunucunun değeri", () => {
    const spec = buildDenyeExport({ report, filterNotes: ["İplik: Polyester 70/800"] });
    const t = spec.tables[0]!;
    expect(t.columns.map((c) => c.header)).toEqual(DENYE_COLUMNS.map((c) => c.header));
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]).toMatchObject({ levent: 5, nominal: 500, net: 520, sapma: "+%4", kart: "70", oneri: "72,8 den" });
    expect(t.rows[2]).toMatchObject({ iplik: "Karma (çok iplikli leventler)", kart: "—", oneri: "Çok iplikli — öneri yok" });
    expect(spec.meta).toContain("İplik: Polyester 70/800");
  });
});
