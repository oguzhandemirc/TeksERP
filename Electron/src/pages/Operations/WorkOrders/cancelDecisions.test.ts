import { describe, expect, it } from "vitest";
import {
  applyBulkChoice,
  buildCancelDispositions,
  formatSummary,
  groupByStation,
  isOptionDisabled,
  summarizeChoices,
} from "./cancelDecisions";
import type { CancelImpactRoll } from "./service";

function roll(over: Partial<CancelImpactRoll> & { id: string }): CancelImpactRoll {
  return {
    barcode: over.id,
    status: "IN_PRODUCTION",
    currentQty: 100,
    colorName: null,
    colorHex: null,
    propertyCount: 0,
    processed: false,
    atSubcontractor: false,
    willRevertToStock: true,
    stationName: "Tambur",
    batchId: null,
    batchNumber: null,
    canReturnToStock: true,
    decidable: true,
    ...over,
  };
}

describe("cancelDecisions", () => {
  it("STOCK satırlarını uca GÖNDERMEZ (backend ikizinin aynası)", () => {
    const rolls = [roll({ id: "a" }), roll({ id: "b" }), roll({ id: "c" })];
    const out = buildCancelDispositions(rolls, { b: "SCRAP", c: "STOCK" });
    // a → varsayılan STOCK, c → açıkça STOCK: ikisi de düşer.
    expect(out).toEqual([{ rollId: "b", action: "SCRAP" }]);
  });

  it("karar verilemeyen topu listeye almaz", () => {
    const rolls = [roll({ id: "a", decidable: false }), roll({ id: "b" })];
    expect(buildCancelDispositions(rolls, { a: "SCRAP", b: "SCRAP" })).toEqual([
      { rollId: "b", action: "SCRAP" },
    ]);
  });

  it("özet varsayılanı STOCK sayar", () => {
    const rolls = [roll({ id: "a" }), roll({ id: "b" }), roll({ id: "c" })];
    expect(summarizeChoices(rolls, { b: "SCRAP", c: "CANCELLED" })).toEqual({
      stock: 1,
      scrap: 1,
      cancelled: 1,
    });
  });

  it("özet metni sıfırları basmaz", () => {
    expect(formatSummary({ stock: 9, scrap: 0, cancelled: 1 })).toBe("9 ham stok · 1 hatalı kayıt");
    expect(formatSummary({ stock: 0, scrap: 0, cancelled: 0 })).toBe("karar bekleyen top yok");
  });

  it("fason dönüşü topa Ham stok seçtirmez", () => {
    const r = roll({ id: "a", canReturnToStock: false });
    expect(isOptionDisabled(r, "STOCK")).toBe(true);
    expect(isOptionDisabled(r, "SCRAP")).toBe(false);
  });

  it("toplu uygulama uygun olmayan topu ATLAR (backend'in reddedeceği liste kurulmaz)", () => {
    const rolls = [roll({ id: "a" }), roll({ id: "b", canReturnToStock: false })];
    const next = applyBulkChoice(rolls, "STOCK", { b: "SCRAP" });
    expect(next.a).toBe("STOCK");
    // b fason dönüşü → dokunulmaz, önceki kararı korunur.
    expect(next.b).toBe("SCRAP");
  });

  it("istasyona göre gruplar", () => {
    const rolls = [
      roll({ id: "a", stationName: "Tambur" }),
      roll({ id: "b", stationName: "Kurşun" }),
      roll({ id: "c", stationName: "Tambur" }),
      roll({ id: "d", stationName: null }),
    ];
    const groups = groupByStation(rolls);
    expect(groups.map((g) => g.stationName)).toEqual(["Tambur", "Kurşun", "—"]);
    expect(groups[0]?.rolls).toHaveLength(2);
  });
});
