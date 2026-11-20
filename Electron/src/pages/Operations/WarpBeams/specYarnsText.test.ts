// Leventler listesi: çok iplikli kartta TÜM iplikler görünür (2026-11-20 devere E2E — yalnız ilki görünüyordu).
import { describe, expect, it } from "vitest";
import { specYarnsText } from "./columns";
import type { WarpBeam } from "./types";

const y = (id: string, name: string, sortOrder: number) => ({ yarnItemId: id, endsCount: 100, sortOrder, yarnItem: { id, code: id, name } });
const spec = (yarns?: ReturnType<typeof y>[]): WarpBeam["warpSpec"] => ({
  id: "s", code: "CZ", name: "Kart", endsCount: 3600, yarnItem: { id: "a", code: "a", name: "70/800", linearDensityDen: 70 }, yarns,
});

describe("specYarnsText", () => {
  it("çok iplikli kart: satır sırasıyla hepsi", () => {
    expect(specYarnsText(spec([y("b", "300 İMG", 1), y("a", "70/800", 0)]))).toBe("70/800 · 300 İMG");
  });
  it("tek satır ya da eski backend (yarns yok): ana iplik", () => {
    expect(specYarnsText(spec([y("a", "70/800", 0)]))).toBe("70/800");
    expect(specYarnsText(spec())).toBe("70/800");
  });
});
