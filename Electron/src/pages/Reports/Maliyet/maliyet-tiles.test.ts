import { describe, expect, it } from "vitest";
import { maliyetReportTiles, visibleMaliyetTiles } from "./tile-config";

// SY-D3: dokuma verimliliği tutar gösterir → `cost:read` ∧ dokuma; kârlılık (D4-G3) `cost:read`; iplik ihtiyacı `report:yarn-need`.
const keys = (perms: string[], weavingOn: boolean) =>
  visibleMaliyetTiles((p) => perms.includes(p), weavingOn).map((t) => t.key);

describe("maliyet rapor karoları", () => {
  it("dokuma verimliliği karosu adresi ve izni backend ucuyla aynı", () => {
    const t = maliyetReportTiles.find((x) => x.key === "dokuma-verimlilik");
    expect(t?.to).toBe("/reports/maliyet/dokuma-verimlilik");
    expect(t?.permission).toBe("cost:read");
  });
  it("cost:read + dokuma açık → görünür; dokuma kapalı ya da izin yok → gizli", () => {
    expect(keys(["cost:read"], true)).toEqual(["karlilik", "dokuma-verimlilik"]);
    expect(keys(["cost:read"], false)).toEqual(["karlilik"]);
    expect(keys(["report:yarn-need"], true)).toEqual(["iplik-ihtiyaci"]);
    expect(keys(["report:yarn-need", "cost:read"], true)).toEqual(["iplik-ihtiyaci", "karlilik", "dokuma-verimlilik"]);
  });
});
