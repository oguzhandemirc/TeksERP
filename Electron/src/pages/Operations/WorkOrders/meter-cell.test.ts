// İE listesi "Metre" sütunu biçimi (GK 2026-11-10): ton sunucu bayraklarından, metin tek yardımcıdan.
import { describe, it, expect, vi } from "vitest";
vi.mock("@/services/apiClient", () => ({ default: { get: vi.fn() } }));
import { meterCellText, meterCellView, type WorkOrderMeterSummary } from "./meter-cell";

const s = (o: Partial<WorkOrderMeterSummary>): WorkOrderMeterSummary => ({
  declaredM: 241, measuredMaxM: null, billedM: 241, diffM: null, diffPct: null, withinTolerance: false, longerThanDeclared: false, ...o,
});

describe("meterCellView", () => {
  it("⭐ beyandan uzun: 'Giren 241 · Çıkan 300 · +59 m' turuncu rozet", () => {
    const v = meterCellView(s({ measuredMaxM: 300, billedM: 300, diffM: 59, diffPct: 24.48, longerThanDeclared: true }));
    expect(v).toMatchObject({ tone: "longer", badge: true, text: "Giren 241 · Çıkan 300 · +59 m" });
    expect(v?.title).toBe("Beyan 241 m · Ölçülen 300 m · Faturalanan 300 m");
  });

  it("⭐ çok partide uzun: sağ taraf faturalanan, fark pozitif kalır", () => {
    expect(meterCellView(s({ declaredM: 2000, measuredMaxM: 1960, billedM: 2010, diffM: -40, longerThanDeclared: true }))?.text).toBe("Giren 2000 · Çıkan 1960 · +10 m");
  });

  it("⭐ kısa: gri rozet 'Giren 1000 · Çıkan 900 · −100 m'", () => {
    expect(meterCellView(s({ declaredM: 1000, measuredMaxM: 900, billedM: 1000, diffM: -100 }))).toMatchObject({ tone: "shorter", badge: true, text: "Giren 1000 · Çıkan 900 · −100 m" });
  });

  it("tolerans içi ve ölçümsüz: sade gri 'Giren 241 · Çıkan …'", () => {
    expect(meterCellView(s({ measuredMaxM: 242, diffM: 1, withinTolerance: true }))).toMatchObject({ tone: "within", badge: false, text: "Giren 241 · Çıkan 242" });
    expect(meterCellView(s({}))).toMatchObject({ tone: "none", badge: false, text: "Giren 241 · Çıkan —" });
  });

  it("beyansız ölçüm, özet yok, eski backend", () => {
    expect(meterCellView(s({ declaredM: null, measuredMaxM: 990, billedM: 990 }))?.text).toBe("Çıkan 990");
    expect(meterCellView(null)).toBeNull();
    expect(meterCellView(undefined)).toBeNull();
    expect(meterCellText(undefined)).toBe("");
    expect(meterCellView(s({ declaredM: null, billedM: null }))).toBeNull();
  });
});
