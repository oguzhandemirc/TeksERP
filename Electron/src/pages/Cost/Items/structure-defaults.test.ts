// Yapı alanı yer tutucusu: boş alan hesaba giren değeri kaynağıyla gösterir; kaynak YAPI ise yedek bilinmez.
import { describe, expect, it } from "vitest";
import type { CostInputSnap } from "../shared/cost-types";
import { defaultPlaceholder, structureDefault } from "./structure-defaults";

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
