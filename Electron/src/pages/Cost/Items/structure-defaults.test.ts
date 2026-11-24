// Yapı alanı yer tutucusu: boş alan hesaba giren değeri kaynağıyla gösterir; kaynak YAPI ise yedek bilinmez.
import { describe, expect, it } from "vitest";
import type { CostInputSnap } from "../shared/cost-types";
import { defaultPlaceholder, structureDefault, structureHint } from "./structure-defaults";

const g = {
  loom: { rpm: { value: "450", source: "PARAMETRE" }, efficiencyPct: { value: "85", source: "YAPI" } },
  warp: null,
  weft: null,
  beam: { lengthM: { value: "3000", source: "PARAMETRE" } },
  fabricWastePct: { value: "1.5", source: "PARAMETRE" },
} as unknown as CostInputSnap;

describe("structureDefault / defaultPlaceholder", () => {
  it("parametre kaynaklı değer + kaynak adı", () => {
    expect(defaultPlaceholder(structureDefault(g, "loomRpm"))).toBe("450 · Parametre");
    expect(defaultPlaceholder(structureDefault(g, "fabricWastePct"))).toBe("1,5 · Parametre");
  });
  it("kaynak YAPI, kart yok ya da alan karşılıksız → genel yer tutucu", () => {
    expect(defaultPlaceholder(structureDefault(g, "efficiencyPct"))).toBe("boş = varsayılan");
    expect(defaultPlaceholder(structureDefault(g, "warpWastePct"))).toBe("boş = varsayılan");
    expect(defaultPlaceholder(structureDefault(g, "extraCostPerMTry"))).toBe("boş = varsayılan");
    expect(defaultPlaceholder(structureDefault(undefined, "loomRpm"))).toBe("boş = varsayılan");
  });
});

describe("structureHint (B18/9)", () => {
  const params = { defaultWarpWastePct: "2", defaultWeftWastePct: "3.5" };
  it("kart bağlı değilken fireler parametre setinden, ⓘ nedenini söyler", () => {
    const w = structureHint(g, "warpWastePct", { params });
    expect(w.placeholder).toBe("2 · Parametre");
    expect(w.info).toMatch(/Çözgü kartı bağlı değil/);
    expect(structureHint(g, "weftWastePct", { params }).placeholder).toBe("3,5 · Parametre");
  });
  it("parametrede de yoksa 'bilinmiyor' + neden", () => {
    const w = structureHint(g, "warpWastePct", { params: { defaultWarpWastePct: null, defaultWeftWastePct: null } });
    expect(w.placeholder).toBe("bilinmiyor");
    expect(w.info).toMatch(/varsayılan yok/);
  });
  it("atkı boyu atkı kartı yokken bilinmiyor, nedeni ⓘ'de", () => {
    const h = structureHint(g, "weftLengthCm");
    expect(h.placeholder).toBe("bilinmiyor");
    expect(h.info).toMatch(/atkı kartı bağlı olmadığı/);
  });
  it("boy çekmesi: seçili tarifenin tipik çekmesi; tarife yoksa ham satış 0", () => {
    expect(structureHint(g, "lengthShrinkPct", { rate: { typicalShrinkPct: "4" } }).placeholder).toBe("4 · Tarife");
    expect(structureHint(g, "lengthShrinkPct", { rate: null }).placeholder).toBe("0 · ham satış");
    expect(structureHint(g, "lengthShrinkPct", { rate: { typicalShrinkPct: null } }).placeholder).toBe("0 · tarifede yok");
  });
  it("bilinen kaynaklı değer olduğu gibi", () => {
    expect(structureHint(g, "loomRpm").placeholder).toBe("450 · Parametre");
    expect(structureHint(g, "extraCostPerMTry").placeholder).toBe("yok");
  });
});
