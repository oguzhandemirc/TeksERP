import { describe, expect, it } from "vitest";
import { overrunInfo, sentText, sentTotals, warpReportText } from "./report-model";
import type { WarpingDispatchItem, WarpingDispatchRow } from "./yarn-types";

const spec = (sequenceNote: string | null) => ({ id: "s", code: "C", name: "Kart", sequenceNote, reedNo: null, reedWidthCm: null, endsPerDent: null });
const yarn = (letter: string, endsCount: number) => ({ letter, endsCount }) as never;

describe("warpReportText", () => {
  it("tek iplik + not yok → 'A · 6.000 tel (tek iplik)'", () => {
    expect(warpReportText({ warpSpec: spec(null), yarns: [yarn("A", 6000)] })).toMatch(/^A · 6\.?000 tel \(tek iplik\)$/);
  });
  it("not varsa not; çok iplik notsuzsa tel payı", () => {
    expect(warpReportText({ warpSpec: spec("2A 1B"), yarns: [yarn("A", 4000), yarn("B", 2000)] })).toBe("2A 1B");
    expect(warpReportText({ warpSpec: spec("  "), yarns: [yarn("A", 4000), yarn("B", 2000)] })).toMatch(/Dizilim girilmemiş — A 4\.?000 tel · B 2\.?000 tel/);
  });
});

const item = (bobbinCount: number | null, packageCount: number | null = null) => ({ bobbinCount, packageCount }) as WarpingDispatchItem;
const row = (status: "ACTIVE" | "CANCELLED", totalOutKg: string, items: WarpingDispatchItem[]) => ({ status, totalOutKg, items }) as WarpingDispatchRow;

describe("sentTotals / sentText", () => {
  it("iptal edilen sevk sayılmaz; bobin toplanır, eksik kalem sayılır", () => {
    const t = sentTotals([row("ACTIVE", "100", [item(40, 2), item(null)]), row("CANCELLED", "50", [item(10)]), row("ACTIVE", "25.5", [item(20)])]);
    expect(t).toEqual({ dispatchCount: 2, kg: 125.5, bobbins: 60, packages: 2, bobbinMissing: 1 });
    const s = sentText(t);
    expect(s.main).toMatch(/125,500 kg · 2 koli · 60 bobin/);
    expect(s.note).toBe("bobin eksik — 1 kalemde girilmemiş");
  });
  it("sevk yok / hiç bobin girilmemiş", () => {
    expect(sentText(sentTotals([])).main).toBe("Henüz sevk yok");
    expect(sentText(sentTotals([row("ACTIVE", "10", [item(null)])])).note).toBe("bobin adedi girilmemiş");
  });
});

describe("overrunInfo", () => {
  it("fark ≤ 0 → null (eksik ya da tam)", () => {
    expect(overrunInfo("-20")).toBeNull();
    expect(overrunInfo("0")).toBeNull();
  });
  it("METRE: +X m × fiyat; ENDS_METRE: × tel; KG: hesaplanmaz", () => {
    expect(overrunInfo("120", { unit: "METRE", unitPrice: "0.05", currency: "USD" })).toEqual({ label: "Fazla devere +120 m", feeNote: "ücret etkisi +120 m × 0,05 = +6,00 USD" });
    expect(overrunInfo("10", { unit: "ENDS_METRE", unitPrice: "0.001", currency: "USD" }, 6000)?.feeNote).toMatch(/× 6\.?000 tel × 0,001 = \+60,00 USD/);
    expect(overrunInfo("10", { unit: "KG", unitPrice: "2", currency: "USD" })?.feeNote).toMatch(/kg başına/);
    expect(overrunInfo("10", { unit: "METRE", unitPrice: null, currency: null })?.feeNote).toBe("ücret girilmemiş");
    expect(overrunInfo("10")?.feeNote).toBeNull();
  });
});
