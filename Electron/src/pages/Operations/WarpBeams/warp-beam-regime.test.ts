import { describe, expect, it } from "vitest";
import { lotSummary } from "./columns";
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
  it("yedi durum — Faz 1b üçlüsü + F1 SHIPPED_OUT + Faz 3 MOUNTED/EXHAUSTED/SCRAPPED; rozet sözlüğü birebir", () => {
    expect([...WARP_BEAM_STATUSES].sort()).toEqual(["CANCELLED", "EXHAUSTED", "MOUNTED", "PLANNED", "READY", "SCRAPPED", "SHIPPED_OUT"]);
    expect(Object.keys(WARP_BEAM_STATUS_META).sort()).toEqual([...WARP_BEAM_STATUSES].sort());
  });
  it("⭐ nominal kg = tel × denye × m / 9.000.000 (belge fixture'ı: 3500 × 300 × 7000 → 816,667)", () => {
    expect(theoreticalKg(3500, 300, 7000)).toBe(816.667);
    expect(theoreticalKg(3500, null, 7000)).toBeNull();
    expect(theoreticalKg(3500, 300, 0)).toBeNull();
  });
});

// Devere Faz 2 (lot). ⭐ NEGATİF SONDA: lotsuz sarım "—" dönünce ② ❌ (sessiz lotsuz); tek lot sayı basınca ③ ❌.
describe("lot özeti (liste hücresi)", () => {
  const wound = { id: "e" } as unknown as NonNullable<Parameters<typeof lotSummary>[0]["wound"]>;
  it("① sarılmamış levent —", () => {
    expect(lotSummary({ wound: null, lots: [] })).toBe("—");
  });
  it("② ⭐ lotsuz SARIM açıkça 'Lot yok' (— değil; iz eksikliği görünür)", () => {
    expect(lotSummary({ wound, lots: [] })).toBe("Lot yok");
  });
  it("③ tek lot adıyla, birden çok lot sayıyla", () => {
    expect(lotSummary({ wound, lots: ["YAN 1029-K"] })).toBe("YAN 1029-K");
    expect(lotSummary({ wound, lots: ["A", "B"] })).toBe("2 lot");
  });
});
