import { describe, expect, it } from "vitest";
import { candidateDetail, orderByFit, suggestionSummary, type LoomCandidate, type LoomSuggestion } from "./types";

const c = (id: string, tier: LoomCandidate["tier"], over: Partial<LoomCandidate> = {}): LoomCandidate => ({
  machineId: id, code: id.toUpperCase(), name: id, tier, weavableM: null, surplusM: null, missingWarpSpecCodes: [], readyBeamNos: [],
  sameDesignRunning: false, hasOpenRun: false, widthWarning: false, ...over,
});
const s = (candidates: LoomCandidate[]): LoomSuggestion => ({ weavingOrderId: "w", itemId: "i", recipeId: null, plannedM: 1000, candidates, warnings: [] });

describe("tezgâh önerisi görünümü (SY-M3)", () => {
  it("Salon sırası sunucu sırasını kademeyle izler; önerisi olmayan sona", () => {
    const sug = s([c("t1", "READY"), c("t3", "WARP_CHANGE"), c("t2", "BEAM_SHORT")]);
    const looms = [{ id: "x" }, { id: "t3" }, { id: "t2" }, { id: "t1" }];
    expect(orderByFit(looms, sug).map((l) => l.id)).toEqual(["t1", "t2", "t3", "x"]);
  });

  it("liste özeti hazır tezgâh sayısını, yoksa en iyi kademeyi verir", () => {
    expect(suggestionSummary(s([c("a", "READY"), c("b", "READY")]))).toEqual({ tier: "READY", text: "A +1" });
    expect(suggestionSummary(s([c("b", "BEAM_SHORT")]))).toEqual({ tier: "BEAM_SHORT", text: "B" });
    expect(suggestionSummary(s([]))).toEqual({ tier: null, text: "—" });
  });

  it("kademe ayrıntısı: T2 dokunabilir metre, T3 eksik kart + hazır levent", () => {
    expect(candidateDetail(c("a", "BEAM_SHORT", { weavableM: 640 }))).toContain("640 m dokur");
    expect(candidateDetail(c("a", "WARP_CHANGE", { missingWarpSpecCodes: ["CZ-1"], readyBeamNos: ["L-7"] }))).toBe("CZ-1 takılmalı · hazır levent: L-7");
    expect(candidateDetail(c("a", "READY", { sameDesignRunning: true, hasOpenRun: true }))).toBe("aynı desen koşuyor");
  });
});
