// İE formu kurşun adımı kartı (Gülkesim 2026-11-02): gramaj + makine önerisi yalnız kurşun adımında;
// adım girince varsayılan gramaj ön seçilir, adım çıkınca hedef temizlenir; stepsToCustom öneriyi taşır.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { KursunStepFields, KursunStepSummary, isKursunStep, kursunDetailText } from "./KursunStepFields";
import { reconcileStepDefaults } from "./stepDefaultTargets";
import type { DefaultTarget, DefaultTargetsByStation } from "@/lib/station-default-targets";
import { stepsToCustom } from "./workOrderPrefill";
import type { DesignerStep } from "./RouteDesignerDialog";

vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () => Promise.resolve({ data: [{ id: "m1", name: "Kurşun M1", stationId: "st-k", code: "M1", isActive: true }] }),
}));

const OPTIONS = [
  { id: "v25", name: "25 gr" },
  { id: "v50", name: "50 gr", isDefault: true },
];
const step = (kind: string | null, extra: Partial<DesignerStep> = {}): DesignerStep => ({
  clientId: "c1", stationId: "st-k", stationCode: "K", stationName: "Kurşun", stationType: "INTERNAL",
  stationKind: kind, notes: "", requiredCategoryId: null, plannedSubcontractorId: null, ...extra,
});
const noop = () => {};

describe("KursunStepFields", () => {
  it("kurşun adımı değilse gramaj/makine çizilmez", () => {
    renderWithProviders(
      <KursunStepFields step={step("TAMBUR")} showGramaj gramajOptions={OPTIONS} gramajValue={null} onGramaj={noop} onMachine={noop} />,
    );
    expect(screen.queryByTestId("kursun-step-fields")).toBeNull();
    expect(isKursunStep(step("PROCESS_QC"))).toBe(true);
  });

  it("⭐ sunucu isKursunStation verirse tür değil o karar verir (kurşun yeteneği kapalı PROCESS_QC → değil)", () => {
    expect(isKursunStep(step("PROCESS_QC", { isKursunStation: false }))).toBe(false);
    expect(isKursunStep(step("INTERNAL", { isKursunStation: true }))).toBe(true);
    renderWithProviders(
      <KursunStepFields step={step("PROCESS_QC", { isKursunStation: false })} showGramaj gramajOptions={OPTIONS} gramajValue={null} onGramaj={noop} onMachine={noop} />,
    );
    expect(screen.queryByTestId("kursun-step-fields")).toBeNull();
  });

  it("kurşun adımında gramaj (seçili değer işaretli) + makine önerisi çizilir", async () => {
    renderWithProviders(
      <KursunStepFields step={step("PROCESS_QC")} showGramaj gramajOptions={OPTIONS} gramajValue="v50" onGramaj={noop} onMachine={noop} />,
    );
    expect(screen.getByTestId("kursun-step-fields")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "50 gr" }).getAttribute("aria-checked")).toBe("true");
    expect(await screen.findByRole("radio", { name: "Kurşun M1" })).toBeTruthy();
  });
});

describe("K20 kurşun seçim özeti (adım çipi + önizleme)", () => {
  it("⭐ metin: çipte '40 gr · M2' (makine kodu), önizlemede makine adı; Hedef yok → gramaj yazılmaz", () => {
    const m = { code: "M2", name: "Kurşun M2" };
    expect(kursunDetailText({ name: "40 gr" }, m, "short")).toBe("40 gr · M2");
    expect(kursunDetailText({ name: "40 gr" }, m, "long")).toBe("40 gr · Kurşun M2");
    expect(kursunDetailText(null, m, "short")).toBe("M2");
    expect(kursunDetailText({ name: "40 gr" }, null, "short")).toBe("40 gr");
    expect(kursunDetailText(null, null, "short")).toBeNull();
    expect(kursunDetailText(null, { code: " ", name: "Kurşun M1" }, "short")).toBe("Kurşun M1");
  });

  it("⭐ bileşen: seçili gramaj + atanan makine yazılır (sarmalayıcıyla)", async () => {
    renderWithProviders(
      <KursunStepSummary step={step("PROCESS_QC", { plannedMachineId: "m1" })} gramajOptions={OPTIONS} gramajValue="v50" mode="short" prefix="· "
        wrap={(n) => <div data-testid="wrap">{n}</div>} />,
    );
    expect(await screen.findByText("· 50 gr · M1")).toBeTruthy();
    expect(screen.getByTestId("wrap")).toBeTruthy();
  });

  it("⭐ Hedef yok + makine önerisi yok → hiçbir şey çizilmez (sarmalayıcı/ayraç dahil); kurşun değilse de", async () => {
    const { container } = renderWithProviders(
      <KursunStepSummary step={step("PROCESS_QC")} gramajOptions={OPTIONS} gramajValue={null} mode="long" wrap={(n) => <div data-testid="wrap">{n}</div>} />,
    );
    await Promise.resolve();
    expect(screen.queryByTestId("wrap")).toBeNull();
    expect(container.textContent).toBe("");
    renderWithProviders(<KursunStepSummary step={step("TAMBUR")} gramajOptions={OPTIONS} gramajValue="v50" mode="short" />);
    expect(screen.queryByTestId("kursun-summary-short")).toBeNull();
  });
});

const T = (o: Partial<DefaultTarget> & Pick<DefaultTarget, "propertyId">): DefaultTarget => ({
  propertyCode: o.propertyId, propertyName: o.propertyId, valueType: "FLAG", mode: "AUTO", variantOfPropertyId: null,
  valueId: null, valueCode: null, valueName: null, source: null, ...o,
});
const BY = {
  sK: [T({ propertyId: "KURSUN" }), T({ propertyId: "GR", valueType: "CHOICE", mode: "REQUIRED", valueId: "v40", source: "VALUE_DEFAULT" })],
  sT: [T({ propertyId: "KAT", propertyCode: "KAT", valueType: "CHOICE", mode: "OPTIONAL", valueId: "k4", valueCode: "4-KAT", source: "STATION" })],
};
const IN = (steps: Array<[string, string]>, byStation: DefaultTargetsByStation | null = BY) => ({
  steps: steps.map(([clientId, stationId]) => ({ clientId, stationId })), byStation, failed: false, gramajPropertyId: "GR",
  gramajAllowed: steps.some(([, s]) => s === "sK"),
});
const EMPTY = { propertyIds: [] as string[], gramaj: null, fold: "" };

describe("K22 rota adımı ön seçimi (reconcileStepDefaults)", () => {
  it("⭐ istasyon seçilince AUTO bayrak + gramaj + kat ön seçilir; cevap gelmeden dokunulmaz", () => {
    expect(reconcileStepDefaults(EMPTY, {}, IN([["a", "sK"]], {})).state).toEqual(EMPTY);
    const r = reconcileStepDefaults(EMPTY, {}, IN([["a", "sK"], ["b", "sT"]]));
    expect(r.state).toEqual({ propertyIds: ["KURSUN"], gramaj: "v40", fold: "4-KAT" });
  });
  it("⭐ kullanıcı seçimi EZİLMEZ (dolu gramaj/kat, elle kaldırılan bayrak geri gelmez)", () => {
    const r1 = reconcileStepDefaults({ propertyIds: [], gramaj: "v25", fold: "2-KAT" }, {}, IN([["a", "sK"], ["b", "sT"]]));
    expect(r1.state.gramaj).toBe("v25");
    expect(r1.state.fold).toBe("2-KAT");
    const r2 = reconcileStepDefaults({ ...r1.state, propertyIds: [] }, r1.records, IN([["a", "sK"], ["b", "sT"]]));
    expect(r2.state.propertyIds).toEqual([]);
  });
  it("⭐ adım çıkınca yalnız o adımın tohumu temizlenir; uç düşerse ön seçim yok", () => {
    const r1 = reconcileStepDefaults(EMPTY, {}, IN([["a", "sK"], ["b", "sT"]]));
    const r2 = reconcileStepDefaults(r1.state, r1.records, IN([["a", "sK"]]));
    expect(r2.state).toEqual({ propertyIds: ["KURSUN"], gramaj: "v40", fold: "" });
    const r3 = reconcileStepDefaults(r2.state, r2.records, IN([]));
    expect(r3.state).toEqual(EMPTY);
    expect(reconcileStepDefaults(EMPTY, {}, { ...IN([["a", "sK"]], null), failed: true }).state).toEqual(EMPTY);
  });
  it("⭐ adım önce, müşteri sonra: ilk cevapta gramaj yoksa sonradan gelen müşteri gramajı tohumlanır", () => {
    const noGramaj = { ...BY, sK: [T({ propertyId: "KURSUN" })] };
    const r1 = reconcileStepDefaults(EMPTY, {}, IN([["a", "sK"]], noGramaj));
    expect(r1.state.gramaj).toBeNull();
    const withCustomer = { ...BY, sK: [T({ propertyId: "KURSUN" }), T({ propertyId: "GR", valueType: "CHOICE", mode: "REQUIRED", valueId: "v50", source: "CUSTOMER" })] };
    const r2 = reconcileStepDefaults(r1.state, r1.records, IN([["a", "sK"]], withCustomer));
    expect(r2.state.gramaj).toBe("v50");
    // Tohum artık bu adımındır: müşteri yine değişince yenilenir.
    const r3 = reconcileStepDefaults(r2.state, r2.records, IN([["a", "sK"]]));
    expect(r3.state.gramaj).toBe("v40");
  });
  it("⭐ elle 'Hedef yok' aynı cevapla geri dolmaz (yalnız cevap değişince tohumlanır)", () => {
    const r1 = reconcileStepDefaults({ ...EMPTY, gramaj: "v25" }, {}, IN([["a", "sK"]]));
    expect(r1.state.gramaj).toBe("v25");
    const r2 = reconcileStepDefaults({ ...r1.state, gramaj: null }, r1.records, IN([["a", "sK"]]));
    expect(r2.state.gramaj).toBeNull();
    const seeded = reconcileStepDefaults(EMPTY, {}, IN([["a", "sK"]]));
    const cleared = reconcileStepDefaults({ ...seeded.state, gramaj: null }, seeded.records, IN([["a", "sK"]]));
    expect(cleared.state.gramaj).toBeNull();
  });
});

describe("stepsToCustom", () => {
  it("öneri biliniyorsa gönderilir; bilinmiyorsa (undefined) gövdeye girmez", () => {
    const out = stepsToCustom([step("PROCESS_QC", { plannedMachineId: "m1" }), step("TAMBUR")]);
    expect(out[0]?.plannedMachineId).toBe("m1");
    expect(Object.keys(out[1] ?? {})).not.toContain("plannedMachineId");
  });
});
