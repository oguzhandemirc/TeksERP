// =============================================================================
// BEKÇİ — iş emri formu "Levent" ön doldurma: çözgü kartı + fasoncu dolar · HEDEF METRE OTOMATİK DOLMAZ
// (kural: metre↔levent çevrimi yapılmaz) · öneri ipucu yalnız take-up varken, "Uygula" ile yazılır ·
// sonradan elle değiştirilen alan ezilmez
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { BeamPrefillField, PlannedMHint, type PlannedMSuggestion } from "./BeamPrefillField";
import { weavingOrderFormDefaults, type WeavingOrderFormValues } from "./schema";

const beamById = vi.fn();
const specById = vi.fn();
vi.mock("@/pages/Operations/WarpBeams/service", () => ({ warpBeamService: { getById: (id: string) => beamById(id), listCursor: vi.fn() } }));
vi.mock("@/pages/WarpSpecs/service", () => ({ warpSpecService: { getById: (id: string) => specById(id) } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// Seçici modalı yerine tek düğme: "levent seç" → onChange("b1").
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange("b1")}>
      levent seç
    </button>
  ),
}));

const BEAM = { id: "b1", beamNo: "LV2610260001", warpSpecId: "w1", plannedLengthM: 1000, subcontractorId: "s1" };

function Harness({ onRead }: { onRead: (v: WeavingOrderFormValues) => void }) {
  const form = useForm<WeavingOrderFormValues>({ defaultValues: weavingOrderFormDefaults });
  const [s, setS] = useState<PlannedMSuggestion | null>(null);
  return (
    <form>
      <BeamPrefillField form={form} onSuggestion={setS} />
      <input aria-label="hedef" {...form.register("plannedM")} />
      <PlannedMHint suggestion={s} onApply={(m) => form.setValue("plannedM", String(m))} />
      <button type="button" onClick={() => form.setValue("warpSpecId", "elle")}>elle kart</button>
      <button type="button" onClick={() => onRead(form.getValues())}>oku</button>
    </form>
  );
}

beforeEach(() => {
  beamById.mockReset().mockResolvedValue({ success: true, data: BEAM });
  specById.mockReset();
});

describe("BeamPrefillField", () => {
  it("⭐ levent seçilince çözgü kartı + fasoncu dolar; hedef metre BOŞ kalır; take-up varken öneri ipucu → Uygula yazar", async () => {
    specById.mockResolvedValue({ success: true, data: { id: "w1", takeUpPct: "8" } });
    const user = userEvent.setup();
    const onRead = vi.fn();
    renderWithProviders(<Harness onRead={onRead} />);
    await user.click(screen.getByText("levent seç"));
    const hint = await screen.findByTestId("wo-plannedM-oneri");
    expect(hint).toHaveTextContent("Öneri: ~920 m");
    await user.click(screen.getByText("oku"));
    expect(onRead).toHaveBeenLastCalledWith(expect.objectContaining({ warpSpecId: "w1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: "" }));
    await user.click(screen.getByTestId("wo-plannedM-uygula"));
    expect(screen.getByLabelText("hedef")).toHaveValue("920");
  });

  it("⭐ take-up yokken öneri ipucu YOK ve hedef metre boş kalır", async () => {
    specById.mockResolvedValue({ success: true, data: { id: "w1", takeUpPct: null } });
    const user = userEvent.setup();
    const onRead = vi.fn();
    renderWithProviders(<Harness onRead={onRead} />);
    await user.click(screen.getByText("levent seç"));
    await waitFor(() => expect(specById).toHaveBeenCalledWith("w1"));
    await user.click(screen.getByText("oku"));
    expect(onRead).toHaveBeenLastCalledWith(expect.objectContaining({ warpSpecId: "w1", plannedM: "" }));
    expect(screen.queryByTestId("wo-plannedM-oneri")).toBeNull();
  });

  it("⭐ ön doldurmadan sonra elle değiştirilen alan korunur (efekt yeniden yazmaz)", async () => {
    specById.mockResolvedValue({ success: true, data: { id: "w1", takeUpPct: null } });
    const user = userEvent.setup();
    const onRead = vi.fn();
    renderWithProviders(<Harness onRead={onRead} />);
    await user.click(screen.getByText("levent seç"));
    await waitFor(() => expect(specById).toHaveBeenCalled());
    await user.click(screen.getByText("elle kart"));
    await user.type(screen.getByLabelText("hedef"), "750");
    await user.click(screen.getByText("oku"));
    expect(onRead).toHaveBeenLastCalledWith(expect.objectContaining({ warpSpecId: "elle", plannedM: "750" }));
  });
});
