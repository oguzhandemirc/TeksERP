import { describe, expect, it } from "vitest";
import { isWarpBeamsVisible } from "./warp-beam-regime";
import { WARP_BEAM_STATUSES, WARP_BEAM_STATUS_META, theoreticalKg } from "./types";

describe("rejim", () => {
  it("⭐ fabrikada (devere modülü kapalı) GÖRÜNMEZ", () => {
    expect(isWarpBeamsVisible({ devereEnabled: false })).toBe(false);
  });
  it("devere modülü açıkken görünür; fazla alan kararı etkilemez", () => {
    expect(isWarpBeamsVisible({ devereEnabled: true })).toBe(true);
    const ctx = { devereEnabled: false, iplikEnabled: true };
    expect(isWarpBeamsVisible(ctx)).toBe(false);
  });
});

describe("sözlük ve formül", () => {
  it("Faz 1b üç durum — MOUNTED/EXHAUSTED bu dilimde YOK", () => {
    expect(WARP_BEAM_STATUSES).toEqual(["PLANNED", "READY", "CANCELLED"]);
    expect(Object.keys(WARP_BEAM_STATUS_META).sort()).toEqual([...WARP_BEAM_STATUSES].sort());
  });
  it("⭐ nominal kg = tel × denye × m / 9.000.000 (belge fixture'ı: 3500 × 300 × 7000 → 816,667)", () => {
    expect(theoreticalKg(3500, 300, 7000)).toBe(816.667);
    expect(theoreticalKg(3500, null, 7000)).toBeNull();
    expect(theoreticalKg(3500, 300, 0)).toBeNull();
  });
});
