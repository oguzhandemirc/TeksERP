// =============================================================================
// BEKÇİ — levent formu katman önerisi (SY-B2): katmanlı işte iki çözgü + "Bu çözgü" düğmesi kartı yazar;
// katmansız işte bileşen HİÇ çizilmez; izin yoksa sorgu atılmaz
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { warpBeamPlanDefaults, type WarpBeamPlanValues } from "./schema";

const getById = vi.fn();
const fetchConstruction = vi.fn();
let perms = true;
vi.mock("@/pages/Operations/WeavingOrders/service", () => ({ weavingOrderService: { getById: (id: string) => getById(id) } }));
vi.mock("@/pages/Items/construction-service", () => ({ fetchEffectiveConstruction: (...a: unknown[]) => fetchConstruction(...a) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: false, hasPermission: () => perms }) }));
import { BeamLayerSuggestions } from "./BeamLayerSuggestions";

let seen = "";
function Host() {
  const form = useForm<WarpBeamPlanValues>({ defaultValues: { ...warpBeamPlanDefaults, weavingOrderId: "wo1" } });
  seen = form.watch("warpSpecId");
  return <BeamLayerSuggestions form={form} />;
}
const construction = (layers: unknown[]) => ({ groundWarp: { id: "g", code: "CZ-ZEMIN", name: "Zemin" }, warpLayers: layers });

beforeEach(() => {
  perms = true;
  getById.mockReset().mockResolvedValue({ success: true, data: { id: "wo1", itemId: "i1", recipeId: null } });
  fetchConstruction.mockReset();
});

describe("BeamLayerSuggestions", () => {
  it("⭐ iki katmanlı iş: iki levent önerisi; düğme çözgü kartını yazar", async () => {
    fetchConstruction.mockResolvedValue(construction([{ role: "LENO", beamMode: "SEPARATE_BEAM", sortOrder: 0, warpSpec: { id: "l", code: "CZ-DONER", name: "Döner" } }]));
    renderWithProviders(<Host />);
    expect(await screen.findByText(/2 levent önerilir/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Bu çözgü için levent" })[1]!);
    await waitFor(() => expect(seen).toBe("l"));
  });
  it("⭐ katmansız iş: hiçbir şey çizilmez", async () => {
    fetchConstruction.mockResolvedValue(construction([]));
    const { container } = renderWithProviders(<Host />);
    await waitFor(() => expect(fetchConstruction).toHaveBeenCalled());
    expect(container.querySelector("[data-testid=beam-layer-suggestions]")).toBeNull();
  });
  it("izin yoksa sorgu atılmaz", async () => {
    perms = false;
    renderWithProviders(<Host />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getById).not.toHaveBeenCalled();
    expect(fetchConstruction).not.toHaveBeenCalled();
  });
});
