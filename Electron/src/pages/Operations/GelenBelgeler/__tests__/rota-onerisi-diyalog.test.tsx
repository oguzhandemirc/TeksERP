// Belgeden iş emri diyaloğu rota ön dolumu: plan ucunun `suggestRoute` önerisi (kaynağıyla) seçili gelir; öneri
// yoksa kullanılamayan kaynakların nedeni yazılır; eski backend kaynak göndermezse bugünkü etiket.
// Negatif sonda: `useWorkOrderPlan` ön dolumu (`plan.data.suggestedRouteTemplateId`) kaldırılınca ⭐ kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WorkOrderFromNoteDialog } from "../WorkOrderFromNoteDialog";
import type { WorkOrderPlan } from "../types";

const apiGet = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (url: string, cfg?: unknown) => apiGet(url, cfg), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: () => Promise.resolve({ data: [
    { id: "r-musteri", name: "Brode rotası", isActive: true, steps: [{ station: { name: "Brode", kind: "BRODE" } }] },
    { id: "r-fabrika", name: "KURŞUN → TAMBUR-1", isActive: true, steps: [{ station: { name: "Kurşun", kind: "KURSUN" } }] },
  ] }),
}));
vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [], isLoading: false, isEmpty: true }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }) }));

const basePlan: WorkOrderPlan = {
  noteId: "n1", noteNo: "GB-0042", status: "APPROVED", owner: { id: "c-yeni", name: "Yeni Müşteri" }, customerBatch: null,
  suggestedRouteTemplateId: null, choiceProperties: [], groups: [],
};
const select = () => screen.getByLabelText("Rota şablonu") as HTMLSelectElement;

describe("WorkOrderFromNoteDialog rota ön dolumu (suggestRoute)", () => {
  beforeEach(() => apiGet.mockReset());

  it("⭐ yeni müşteri: fabrika varsayılanı önceden seçili + kaynak etiketi", async () => {
    apiGet.mockResolvedValue({ data: { success: true, data: { ...basePlan, suggestedRouteTemplateId: "r-fabrika", suggestedRouteSource: "FACTORY_DEFAULT", routeSuggestionNotes: [`Müşterinin rotalı önceki terbiye iş emri yok.`] } } });
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(select().value).toBe("r-fabrika"));
    expect(screen.getByText(/Rota şablonu \(fabrika varsayılanı\)/)).toBeTruthy();
    expect(screen.queryByTestId("plan-route-notes")).toBeNull();
  });

  it("müşteriye tanımlı rota kaynağı etiketi", async () => {
    apiGet.mockResolvedValue({ data: { success: true, data: { ...basePlan, suggestedRouteTemplateId: "r-musteri", suggestedRouteSource: "CUSTOMER_ROUTE", routeSuggestionNotes: [] } } });
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(select().value).toBe("r-musteri"));
    expect(screen.getByText(/müşteriye tanımlı rota/)).toBeTruthy();
  });

  it("öneri yok: seçici boş + her kaynağın nedeni", async () => {
    apiGet.mockResolvedValue({ data: { success: true, data: { ...basePlan, suggestedRouteSource: null, routeSuggestionNotes: ["Müşteriye tanımlı birden çok rota şablonu var (A, B); hangisi olduğu belirsiz.", "Fabrika varsayılan rotası ayarlanmamış."] } } });
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    const notes = await screen.findByTestId("plan-route-notes");
    expect(notes).toHaveTextContent("birden çok rota şablonu");
    expect(notes).toHaveTextContent("Fabrika varsayılan rotası ayarlanmamış.");
    expect(select().value).toBe("");
  });

  it("eski backend (kaynak alanı yok) → bugünkü etiket 'bu sahibin son kullandığı'", async () => {
    apiGet.mockResolvedValue({ data: { success: true, data: { ...basePlan, suggestedRouteTemplateId: "r-musteri" } } });
    renderWithProviders(<WorkOrderFromNoteDialog noteId="n1" open onOpenChange={() => {}} />);
    await waitFor(() => expect(select().value).toBe("r-musteri"));
    expect(screen.getByText(/bu sahibin son kullandığı/)).toBeTruthy();
  });
});
