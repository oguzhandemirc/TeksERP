// BEKÇİ — Fasondaki İplik saf katmanı: kırılım sırası + grup başı/toplamı, devreden kg, özet, yaş.
import { describe, expect, it } from "vitest";
import { ageDays, carriedKg, summarize, toLines } from "./model";
import type { YarnAtSubRow } from "./service";

function row(p: Partial<YarnAtSubRow>): YarnAtSubRow {
  return {
    subcontractorId: "s1", subcontractorCode: "F1", subcontractorName: "Beta Devere",
    yarnItemId: "y1", yarnItemCode: "PES50", yarnItemName: "PES 50",
    lotId: null, lotNo: null, ownerCustomerId: null, ownerCustomerName: null,
    kg: "10.000", oldestDispatchedAt: "2026-11-01T09:00:00Z",
    orders: [{ warpingOrderId: "o1", orderNo: "FDV1", status: "IN_PROGRESS", kg: "10.000" }],
    ...p,
  };
}

const rows = [
  row({ subcontractorId: "s1", subcontractorName: "Beta Devere", yarnItemId: "y2", yarnItemName: "Viskon 30", kg: "5" }),
  row({ subcontractorId: "s2", subcontractorName: "Alfa Çözgü", yarnItemId: "y1", yarnItemName: "PES 50", kg: "7.5", orders: [{ warpingOrderId: "o2", orderNo: "FDV2", status: "COMPLETED", kg: "7.5" }] }),
  row({ subcontractorId: "s1", subcontractorName: "Beta Devere", yarnItemId: "y1", yarnItemName: "PES 50", kg: "2.5", lotNo: "L-9", lotId: "l9" }),
];

describe("toLines — iki yönlü kırılım", () => {
  it("fasoncuya göre: ad sırası, grup başı yalnız ilk satırda, grup toplamı", () => {
    const l = toLines(rows, "subcontractor");
    expect(l.map((x) => `${x.groupLabel}|${x.yarnItemName}`)).toEqual(["Alfa Çözgü|PES 50", "Beta Devere|PES 50", "Beta Devere|Viskon 30"]);
    expect(l.map((x) => x.groupFirst)).toEqual([true, true, false]);
    expect(l[1]?.groupKg).toBe(7.5);
    expect(l[1]?.groupLines).toBe(2);
  });
  it("ipliğe göre: iplik ana boyut, aynı iplik iki fasoncuda tek grup", () => {
    const l = toLines(rows, "yarn");
    expect(l.map((x) => `${x.groupLabel}|${x.subcontractorName}`)).toEqual(["PES 50|Alfa Çözgü", "PES 50|Beta Devere", "Viskon 30|Beta Devere"]);
    expect(l[0]?.groupKg).toBe(10);
    expect(l.map((x) => x.groupFirst)).toEqual([true, false, true]);
  });
  it("satır kaybolmaz (sıralama süzmez)", () => {
    expect(toLines(rows, "yarn")).toHaveLength(rows.length);
  });
});

describe("özet + devreden + yaş", () => {
  it("devreden = yalnız COMPLETED sipariş payı", () => {
    expect(carriedKg(rows[1] as YarnAtSubRow)).toBe(7.5);
    expect(carriedKg(rows[0] as YarnAtSubRow)).toBe(0);
  });
  it("özet şeridi aynı kümeden", () => {
    const s = summarize(rows, new Date("2026-11-18T10:00:00Z"));
    expect(s).toEqual({ totalKg: 15, subcontractorCount: 2, yarnCount: 2, carriedKg: 7.5, oldestDays: 17 });
    expect(summarize([]).oldestDays).toBeNull();
  });
  it("yaş fabrika günüyle; bozuk tarih 0", () => {
    expect(ageDays("2026-11-18T05:00:00Z", new Date("2026-11-18T10:00:00Z"))).toBe(0);
    expect(ageDays("bozuk")).toBe(0);
  });
});
