// =============================================================================
// BEKÇİ — levent formu: iş emri seçilince çözgü kartı + fasoncu (köken fasona geçer) + not o işten dolar;
// plan metresi DOLMAZ (çözgü ≠ kumaş metresi); dolu not ezilmez; düzenlemede ön doldurma yok
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { WarpBeamFormDialog } from "./WarpBeamFormDialog";
import type { WarpBeam } from "./types";

const woById = vi.fn();
vi.mock("@/pages/Operations/WeavingOrders/service", () => ({ weavingOrderService: { getById: (id: string) => woById(id) }, weavingOrderPickerService: {} }));
vi.mock("@/hooks/usePricingEnabled", async (orig) => {
  const m = await orig<typeof import("@/hooks/usePricingEnabled")>();
  return { ...m, useDevereBeamWeavingLinkRequired: () => false, useEmanetEnabled: () => false };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// Her seçici tek düğme: tık → sabit id; değer metin olarak görünür.
const PICKS: Record<string, string> = { "weaving-orders-beam": "wo1" };
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ queryKey, value, onChange }: { queryKey: string; value: string | null; onChange: (id: string | null) => void }) => (
    <button type="button" data-testid={`pick-${queryKey}`} onClick={() => onChange(PICKS[queryKey] ?? null)}>
      {value ?? ""}
    </button>
  ),
}));

const WO = { id: "wo1", warpSpecId: "w1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", notes: "tahar 4" };

beforeEach(() => woById.mockReset().mockResolvedValue({ success: true, data: WO }));

describe("WarpBeamFormDialog — iş emrinden ön doldurma", () => {
  it("⭐ iş emri seçilince çözgü kartı + fasoncu + not dolar, köken 'Fasona sardırıldı'ya geçer; plan metresi boş kalır", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarpBeamFormDialog open onOpenChange={() => {}} onSubmit={vi.fn()} />);
    await user.click(screen.getByTestId("pick-weaving-orders-beam"));
    await waitFor(() => expect(screen.getByTestId("pick-warp-specs-beam")).toHaveTextContent("w1"));
    expect(screen.getByTestId("pick-subcontractors-warp-beam")).toHaveTextContent("s1");
    expect(screen.getByDisplayValue("tahar 4")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
  });

  it("⭐ elle yazılmış not ezilmez", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarpBeamFormDialog open onOpenChange={() => {}} onSubmit={vi.fn()} />);
    const notes = screen.getAllByRole("textbox").find((t) => t.tagName === "TEXTAREA")!;
    await user.type(notes, "benim");
    await user.click(screen.getByTestId("pick-weaving-orders-beam"));
    await waitFor(() => expect(screen.getByTestId("pick-warp-specs-beam")).toHaveTextContent("w1"));
    expect(notes).toHaveValue("benim");
  });

  it("düzenlemede iş emri seçimi ön doldurmaz", async () => {
    const user = userEvent.setup();
    const initial = { id: "b1", beamNo: "LV1", warpSpecId: "w9", plannedLengthM: 900, originKind: "IN_HOUSE", subcontractorId: null, supplierId: null, physicalBeamNo: null, notes: null, weavingOrder: null } as unknown as WarpBeam;
    renderWithProviders(<WarpBeamFormDialog open onOpenChange={() => {}} onSubmit={vi.fn()} initial={initial} />);
    await user.click(screen.getByTestId("pick-weaving-orders-beam"));
    expect(woById).not.toHaveBeenCalled();
    expect(screen.getByTestId("pick-warp-specs-beam")).toHaveTextContent("w9");
  });
});
