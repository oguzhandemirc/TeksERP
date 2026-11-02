// İE formu kurşun adımı kartı (Gülkesim 2026-11-02): gramaj + makine önerisi yalnız kurşun adımında;
// adım girince varsayılan gramaj ön seçilir, adım çıkınca hedef temizlenir; stepsToCustom öneriyi taşır.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { renderWithProviders } from "@/test/render";
import { KursunStepFields, isKursunStep, useKursunGramajBinding } from "./KursunStepFields";
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

function useHarness(initialHas: boolean, options = OPTIONS) {
  const [has, setHas] = useState(initialHas);
  const [value, setValue] = useState<string | null>(null);
  useKursunGramajBinding({ enabled: true, hasKursun: has, options, value, setValue });
  return { value, setValue, setHas };
}

describe("useKursunGramajBinding", () => {
  it("kurşun adımı yokken hedef boş; adım girince varsayılan ön seçilir", () => {
    const { result, rerender } = renderHook(() => useHarness(false));
    expect(result.current.value).toBeNull();
    act(() => result.current.setHas(true));
    rerender();
    expect(result.current.value).toBe("v50");
  });

  it("kullanıcı 'Hedef yok' seçerse varsayılan geri gelmez; adım silinince hedef temizlenir", () => {
    const { result, rerender } = renderHook(() => useHarness(true));
    expect(result.current.value).toBe("v50");
    act(() => result.current.setValue(null));
    rerender();
    expect(result.current.value).toBeNull();
    act(() => result.current.setValue("v25"));
    rerender();
    act(() => result.current.setHas(false));
    rerender();
    expect(result.current.value).toBeNull();
  });

  it("varsayılan alanı gelmezse (eski backend) hiçbiri seçilmez", () => {
    const { result } = renderHook(() => useHarness(true, [{ id: "v25", name: "25 gr" }]));
    expect(result.current.value).toBeNull();
  });
});

describe("stepsToCustom", () => {
  it("öneri biliniyorsa gönderilir; bilinmiyorsa (undefined) gövdeye girmez", () => {
    const out = stepsToCustom([step("PROCESS_QC", { plannedMachineId: "m1" }), step("TAMBUR")]);
    expect(out[0]?.plannedMachineId).toBe("m1");
    expect(Object.keys(out[1] ?? {})).not.toContain("plannedMachineId");
  });
});
