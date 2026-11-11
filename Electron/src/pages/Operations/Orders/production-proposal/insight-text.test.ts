import { describe, expect, it } from "vitest";
import { durationInputsText, durationLine, loomCountsText, loomLine, shrinkSourceText, wasteNote, yarnLine } from "./insight-text";
import type { LoomSummary, WeavingDurationEstimate, YarnSummary } from "./types";

const loom = (best: Partial<LoomSummary["best"]>, counts: Partial<LoomSummary["counts"]> = {}): LoomSummary => ({
  requiredM: 1000,
  best: { machineId: "m7", code: "T-07", name: "Tezgâh 7", tier: "READY", weavableM: null, readyBeamNo: null, sameDesignRunning: false, hasOpenRun: false, widthWarning: false, ...best },
  counts: { READY: 0, BEAM_SHORT: 0, WARP_CHANGE: 0, ...counts },
});
const yarn = (yarns: YarnSummary["yarns"], totalShortKg: number | null): YarnSummary => ({ rawM: 1000, yarns, totalShortKg, sources: { stock: totalShortKg !== null, openPurchase: true, readyBeams: true } });
const dur = (over: Partial<WeavingDurationEstimate> = {}): WeavingDurationEstimate => ({
  machineId: "m7", picksPerCm: 24, planRpm: 420, planEfficiencyPct: 85, weavingHours: 117.4, weavingDays: 4.89, hoursUntilDeadline: 200, weavingOnlyFitsDeadline: null, ...over,
});

describe("üretim önerisi karar satırları", () => {
  it("null/undefined özet satır üretmez", () => {
    for (const v of [null, undefined]) {
      expect(loomLine(v)).toBeNull();
      expect(loomCountsText(v)).toBeNull();
      expect(yarnLine(v)).toBeNull();
      expect(durationLine(v)).toBeNull();
    }
    expect(yarnLine(yarn([], 0))).toBeNull();
  });

  it("tezgâh: üç sınıfın metni", () => {
    expect(loomLine(loom({ tier: "READY" }))).toBe("T-07 hazır");
    expect(loomLine(loom({ tier: "BEAM_SHORT", weavableM: 620 }))).toBe("T-07 tezgâhında levent yetmez, 620 m dokur");
    expect(loomLine(loom({ tier: "BEAM_SHORT", weavableM: null }))).toBe("T-07 tezgâhında levent yetmez");
    expect(loomLine(loom({ tier: "WARP_CHANGE", readyBeamNo: "L-12" }))).toBe("Çözgü değişimi gerekir (T-07, hazır levent L-12)");
    expect(loomLine(loom({ tier: "WARP_CHANGE" }))).toBe("Çözgü değişimi gerekir (T-07)");
  });

  it("tezgâh sayaçları: sıfır olan yazılmaz", () => {
    expect(loomCountsText(loom({}, { BEAM_SHORT: 2, WARP_CHANGE: 5 }))).toBe("levent kısa 2 · değişim 5");
    expect(loomCountsText(loom({}, { READY: 1 }))).toBe("hazır 1");
    expect(loomCountsText(loom({}, {}))).toBeNull();
  });

  it("iplik: yeterli / tek eksik / çoklu eksik / stok bilinmiyor", () => {
    const a = { yarnItemId: "a", code: "IP-150D", name: "Polyester 150D", needKg: 80, shortKg: 34.2 };
    const b = { yarnItemId: "b", code: "IP-75D", name: "Polyester 75D", needKg: 40, shortKg: 10.3 };
    const c = { yarnItemId: "c", code: "IP-50D", name: "Polyester 50D", needKg: 20, shortKg: 6.5 };
    const ok = { ...b, shortKg: 0 };
    expect(yarnLine(yarn([ok], 0))).toBe("İplik yeterli");
    expect(yarnLine(yarn([a, ok], 34.2))).toBe("IP-150D: 34,2 kg eksik");
    expect(yarnLine(yarn([b, a, c], 51))).toBe("IP-150D: 34,2 kg eksik ve 2 iplik daha, toplam 51 kg");
    expect(yarnLine(yarn([{ ...a, shortKg: null }, { ...b, shortKg: null }], null))).toBe("İplik ihtiyacı 120 kg");
  });

  it("süre: termin karşılaştırması yumuşak, null'da terminden söz edilmez", () => {
    expect(durationLine(dur())).toBe("Dokuma yaklaşık 4,9 gün (117 saat)");
    expect(durationLine(dur({ weavingOnlyFitsDeadline: true }))).toBe("Dokuma yaklaşık 4,9 gün (117 saat) — yalnız dokuma süresiyle termine sığıyor");
    expect(durationLine(dur({ weavingOnlyFitsDeadline: false }))).toBe("Dokuma yaklaşık 4,9 gün (117 saat) — yalnız dokuma süresi bile termini aşıyor");
    expect(durationLine(dur())).not.toMatch(/yetiş/);
    expect(durationInputsText(dur(), "T-07")).toBe("T-07 · devir 420/dk · verim %85 · atkı sıklığı 24 atkı/cm");
  });

  it("fire notu 0'da yok; çekme kaynağı", () => {
    expect(wasteNote(2)).toBe("%2 dokuma firesi dahil");
    expect(wasteNote(0)).toBeNull();
    expect(wasteNote(undefined)).toBeNull();
    expect(shrinkSourceText("YAPI")).toBe("ürün yapısından");
    expect(shrinkSourceText(null)).toBeNull();
  });
});
