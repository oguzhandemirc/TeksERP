import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COST_INPUT_TABS, costInputTabPath, resolveCostInputTab } from "./tabs-config";

describe("Girdi Fiyatları sekmeleri (M6)", () => {
  it("tanınmayan ya da boş sekme iplik fiyatlarına düşer", () => {
    expect(resolveCostInputTab(null)).toBe("yarn");
    expect(resolveCostInputTab("yok")).toBe("yarn");
    expect(resolveCostInputTab("norms")).toBe("norms");
  });

  it("eski dört yol ilgili sekmeye yönlenir (content-routes)", () => {
    const src = readFileSync(resolve(__dirname, "../../../routes/content-routes.tsx"), "utf8");
    const legacy: Record<string, string> = { "cost/yarn-prices": "yarn", "cost/finishing-rates": "finishing", "cost/formulas": "formulas", "cost/consumable-norms": "norms" };
    for (const [path, tab] of Object.entries(legacy)) {
      expect(src, path).toContain(`{ path: "${path}", element: <Navigate to={costInputTabPath("${tab}")} replace /> }`);
    }
    expect(COST_INPUT_TABS.map((t) => t.key).sort()).toEqual(Object.values(legacy).sort());
    expect(costInputTabPath("formulas")).toBe("/cost/input-prices?tab=formulas");
  });
});
