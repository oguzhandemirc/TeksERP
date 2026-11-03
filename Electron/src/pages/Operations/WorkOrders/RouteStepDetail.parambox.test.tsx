// K20 kurşun adımı: "işlem + işlem parametresi" — özellik (yapılan iş) + gramaj/makine TEK "Kurşun ayarları" kutusunda;
// "Yeni özellik tanımla" özellik satırının yanında küçük bağlantı. Kutu verilmeyen adım bugünkü düzende.
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { RouteStepDetail, type RouteTargetBinding } from "./RouteStepDetail";
import type { DesignerStep } from "./RouteDesignerDialog";

vi.mock("@/pages/StationCapabilities/service", () => ({
  stationCapabilityService: {
    getByStation: () => Promise.resolve({ data: { canApplyColor: false, canApplyProperty: true, properties: [{ id: "p-k", name: "Kurşunlu", valueType: "FLAG" }] } }),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({ EntityPickerModal: () => <div /> }));
vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <div /> }));

const step: DesignerStep = {
  clientId: "c1", stationId: "st-k", stationCode: "K", stationName: "Kurşun", stationType: "INTERNAL",
  stationKind: "PROCESS_QC", notes: "", requiredCategoryId: null, plannedSubcontractorId: null,
};
const onProperties = vi.fn();
const target: RouteTargetBinding = { colorId: null, propertyIds: [], onColor: vi.fn(), onProperties };
const noop = () => {};
const base = { step, sequence: 1, canMoveUp: false, canMoveDown: false, onPickStation: noop, onSetNotes: noop, onSetFirm: noop, onMove: noop, onRemove: noop, target };

describe("RouteStepDetail — işlem ayarları kutusu", () => {
  it("⭐ kutu: başlık → Özellik (Kurşunlu çipi + küçük 'Yeni özellik tanımla' bağlantısı) → parametre içeriği", async () => {
    renderWithProviders(<RouteStepDetail {...base} paramBox={{ title: "Kurşun ayarları", content: <div data-testid="params">GRAMAJ+MAKİNE</div> }} />);
    const box = await screen.findByTestId("step-param-box");
    expect(within(box).getByText("Kurşun ayarları")).toBeTruthy();
    const prop = await within(box).findByTestId("step-param-property");
    expect(within(prop).getByText("Kurşunlu")).toBeTruthy();
    expect(within(prop).getByTestId("quick-add-property-link")).toHaveTextContent("Yeni özellik tanımla");
    // Sıra: özellik satırı parametrelerden ÖNCE.
    const params = within(box).getByTestId("params");
    expect(prop.compareDocumentPosition(params) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Eski ayrı başlık ve büyük düğme yok.
    expect(screen.queryByText("Bu istasyonda uygulanan özellikler")).toBeNull();
    await userEvent.click(within(prop).getByText("Kurşunlu"));
    expect(onProperties).toHaveBeenCalledWith(["p-k"]);
  });

  it("kutu verilmezse bugünkü düzen (ayrı başlık + büyük düğme)", async () => {
    renderWithProviders(<RouteStepDetail {...base} />);
    expect(await screen.findByText("Bu istasyonda uygulanan özellikler")).toBeTruthy();
    expect(screen.queryByTestId("step-param-box")).toBeNull();
    expect(screen.queryByTestId("quick-add-property-link")).toBeNull();
    expect(screen.getByRole("button", { name: /Yeni özellik tanımla/ })).toBeTruthy();
  });
});
