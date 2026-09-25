import { describe, expect, it } from "vitest";
import { diffCloseSnapshot, totalsDelta, type CloseSnapshotLine, type LiveProducedItem } from "./closeSnapshotDiff";

const line = (o: Partial<CloseSnapshotLine> = {}): CloseSnapshotLine => ({
  rollId: "r1", barcode: "B1", producedQtyM: 100, qtyM: 100, colorLabel: "Lacivert",
  qualityGrade: "1.KALITE", bucket: "WAREHOUSE", status: "WAREHOUSE", ...o,
});
const live = (o: Partial<LiveProducedItem> = {}): LiveProducedItem => ({
  id: "r1", barcode: "B1", qualityGrade: "1.KALITE", currentQty: 100, status: "WAREHOUSE",
  color: { name: "Lacivert" }, ...o,
});

describe("diffCloseSnapshot", () => {
  it("değişmeyen top listede yok", () => {
    expect(diffCloseSnapshot([line()], [live()])).toEqual([]);
  });

  it("sevk, kalite, renk ve metre değişimi okunur cümle olur", () => {
    const d = diffCloseSnapshot([line()], [live({ status: "SHIPPED", qualityGrade: "FIRE", color: { name: "Siyah" }, currentQty: 81 })])[0]!;
    expect(d.changes).toHaveLength(4);
    expect(d.changes[0]).toMatch(/^Durum: .* → /);
    expect(d.changes[1]).toBe("Kalite: 1.KALITE → FIRE");
    expect(d.changes[2]).toBe("Renk: Lacivert → Siyah");
    expect(d.changes[3]).toMatch(/^Metre: 100 → 81$/);
  });

  it("canlı kümeden düşen top ve kapanıştan sonra eklenen top ayrı işaretlenir", () => {
    const d = diffCloseSnapshot([line()], [live({ id: "r2", barcode: "B2" })]);
    expect(d.map((x) => [x.rollId, x.changes[0]])).toEqual([
      ["r1", "Çıktı listesinden düştü (yeniden işlendi ya da iptal)"],
      ["r2", "Kapanıştan sonra eklendi"],
    ]);
  });

  it("yuvarlama gürültüsü metre farkı sayılmaz", () => {
    expect(diffCloseSnapshot([line({ producedQtyM: 100 })], [live({ currentQty: 100.01 })])).toEqual([]);
  });
});

describe("totalsDelta", () => {
  it("fark yoksa null, varsa işaretli kısa özet", () => {
    expect(totalsDelta({ count: 13, meters: 499 }, { count: 13, meters: 499 })).toBeNull();
    expect(totalsDelta({ count: 13, meters: 499 }, { count: 12, meters: 480 })).toBe("−1 top, −19 m");
    expect(totalsDelta({ count: 2, meters: 220 }, { count: 2, meters: 250.5 })).toBe("+30,5 m");
  });
});
