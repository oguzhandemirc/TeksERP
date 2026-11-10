import { describe, it, expect } from "vitest";
import { routeStepsToCreatePayload, stepsToCustom } from "./workOrderPrefill";
import type { DesignerStep } from "./RouteDesignerDialog";

function step(over: Partial<DesignerStep>): DesignerStep {
  return {
    clientId: "c1",
    serverId: null,
    stationId: "st-1",
    stationCode: "BOYA_FASON",
    stationName: "Boyahane",
    stationType: "INTERNAL",
    stationKind: null,
    notes: "",
    requiredCategoryId: null,
    plannedSubcontractorId: null,
    ...over,
  };
}

describe("routeStepsToCreatePayload (rota şablonu kaydetme payload'ı)", () => {
  it("fason adımının seçili firmasını (plannedSubcontractorId) ve kategorisini KORUR", () => {
    // Regresyon kilidi: WO formundaki 'şablon kaydet' kısayolları eskiden bu iki
    // alanı düşürüyordu → şablona seçilen fason firma kaydedilmiyordu.
    const out = routeStepsToCreatePayload([
      step({ stationType: "EXTERNAL", requiredCategoryId: "cat-boya", plannedSubcontractorId: "firm-boyer" }),
    ]);
    expect(out).toEqual([
      {
        stationId: "st-1",
        sequence: 1,
        defaultNotes: null,
        requiredCategoryId: "cat-boya",
        plannedSubcontractorId: "firm-boyer",
        dispatchWithoutColor: false,
      },
    ]);
  });

  it('"fasona renksiz git" işaretini ŞABLONA taşır', () => {
    // 2026-08-25 regresyon kilidi: bu alan payload'da yokken kutu panelde
    // işaretleniyor, şablona hiç yazılmıyordu → şablondan açılan her iş emrinde
    // yeniden işaretlenmesi gerekirdi (ve o yol da kırıktı). Bkz. backend
    // bekçisi scripts/test_dispatch_without_color.ts.
    const out = routeStepsToCreatePayload([
      step({ stationType: "EXTERNAL", requiredCategoryId: "cat-boya", dispatchWithoutColor: true }),
      step({ stationId: "st-2", stationType: "INTERNAL" }),
    ]);
    expect(out.map((s) => s.dispatchWithoutColor)).toEqual([true, false]);
  });

  it("sequence 1-tabanlı + sıralı, defaultNotes trim'li (boş → null)", () => {
    const out = routeStepsToCreatePayload([
      step({ stationId: "a", notes: "  not  " }),
      step({ stationId: "b", notes: "" }),
      step({ stationId: "c", notes: "   " }),
    ]);
    expect(out.map((s) => s.sequence)).toEqual([1, 2, 3]);
    expect(out.map((s) => s.defaultNotes)).toEqual(["not", null, null]);
    expect(out.map((s) => s.stationId)).toEqual(["a", "b", "c"]);
  });

  it("firma seçilmemiş adımda null kalır (default ezme yok)", () => {
    const out = routeStepsToCreatePayload([step({ requiredCategoryId: "cat", plannedSubcontractorId: null })]);
    expect(out.map((s) => s.plannedSubcontractorId)).toEqual([null]);
    expect(out.map((s) => s.requiredCategoryId)).toEqual(["cat"]);
  });

  it("boş liste → boş payload", () => {
    expect(routeStepsToCreatePayload([])).toEqual([]);
  });
});

describe("çıktı aşaması (outputStage, 2026-11-10) — elle kurulan allowlist", () => {
  it("bilinmiyorsa (undefined) özel rota gövdesine YAZILMAZ: sunucu adımın aşamasını korur", () => {
    expect("outputStage" in stepsToCustom([step({})])[0]!).toBe(false);
  });
  it("biliniyorsa gönderilir; null = otomatik de gönderilir", () => {
    expect(stepsToCustom([step({ outputStage: "SEMI_FINISHED" })])[0]!.outputStage).toBe("SEMI_FINISHED");
    expect(stepsToCustom([step({ outputStage: null })])[0]!.outputStage).toBeNull();
  });
  it("şablon kaydı: açık aşama taşınır, otomatikte gövde eskisiyle aynı", () => {
    expect(routeStepsToCreatePayload([step({ outputStage: "FINISHED" })])[0]!.outputStage).toBe("FINISHED");
    expect("outputStage" in routeStepsToCreatePayload([step({ outputStage: null })])[0]!).toBe(false);
  });
});
