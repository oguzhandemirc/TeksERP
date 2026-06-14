import { describe, it, expect } from "vitest";
import { routeStepsToCreatePayload } from "./workOrderPrefill";
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
      { stationId: "st-1", sequence: 1, defaultNotes: null, requiredCategoryId: "cat-boya", plannedSubcontractorId: "firm-boyer" },
    ]);
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
