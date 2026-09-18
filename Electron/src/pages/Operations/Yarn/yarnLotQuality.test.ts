// BEKÇİ — iplik lotu kalite (saf): eski backend → Serbest · geçişler mevcut hariç · onay yalnız Bloke · süzgeç CSV değerleri
import { describe, expect, it } from "vitest";
import { lotQualityOf, qualityFilterParam, qualityNeedsConfirm, qualityTargets, YARN_LOT_QUALITY, YARN_LOT_QUALITY_ACTION, YARN_LOT_QUALITY_FILTER_OPTIONS } from "./yarnLotQuality";

describe("yarnLotQuality", () => {
  it("eski backend alanı göndermez → Serbest (bugünkü davranış)", () => {
    expect(lotQualityOf({})).toBe("RELEASED");
    expect(lotQualityOf({ qualityStatus: null })).toBe("RELEASED");
    expect(lotQualityOf({ qualityStatus: "BLOCKED" })).toBe("BLOCKED");
  });
  it("geçişler: mevcut durum sunulmaz, öteki ikisi sabit sırada", () => {
    expect(qualityTargets("RELEASED")).toEqual(["ON_HOLD", "BLOCKED"]);
    expect(qualityTargets("ON_HOLD")).toEqual(["RELEASED", "BLOCKED"]);
    expect(qualityTargets("BLOCKED")).toEqual(["RELEASED", "ON_HOLD"]);
  });
  it("⭐ onay diyaloğu YALNIZ Bloke'de", () => {
    expect(qualityNeedsConfirm("BLOCKED")).toBe(true);
    expect(qualityNeedsConfirm("ON_HOLD")).toBe(false);
    expect(qualityNeedsConfirm("RELEASED")).toBe(false);
  });
  it("etiketler ve süzgeç: her durumun rozeti + eylemi var; süzgeç değeri düz CSV", () => {
    for (const s of ["RELEASED", "ON_HOLD", "BLOCKED"] as const) {
      expect(YARN_LOT_QUALITY[s].label).toBeTruthy();
      expect(YARN_LOT_QUALITY_ACTION[s]).toBeTruthy();
    }
    expect(YARN_LOT_QUALITY_FILTER_OPTIONS.map((o) => o.value)).toEqual(["ALL", "RELEASED", "ON_HOLD", "BLOCKED", "RELEASED,ON_HOLD"]);
    expect(qualityFilterParam("ALL")).toBeUndefined();
    expect(qualityFilterParam("RELEASED,ON_HOLD")).toBe("RELEASED,ON_HOLD");
  });
});
