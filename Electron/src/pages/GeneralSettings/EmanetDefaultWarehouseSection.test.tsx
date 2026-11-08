// Emanet varsayılan deposu bölümü (genel fason P1): emanet kapalıyken çizilmez ve istek atmaz; kayıtlı depo
// seçicide görünür; "Boş" seçip Kaydet uca warehouseId:null yazar (ayar şifresi sarmalayıcısından); kullanılamaz depo uyarı verir.
// Negatif sonda (2026-11-08): `if (!emanetOn) return null` kaldırılınca §1 kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EmanetDefaultWarehouseSection } from "./EmanetDefaultWarehouseSection";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), emanet: true }));
vi.mock("@/services/apiClient", () => ({ default: { get: mocks.get, put: mocks.put } }));
vi.mock("@/lib/settings-password", () => ({ withSettingsPassword: (fn: (h: Record<string, string>) => unknown) => fn({}) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useEmanetEnabled: () => mocks.emanet }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// Seçici modal: düğme etiketi = seçili id; "boşalt" düğmesi onChange(null) çağırır.
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <button type="button" data-testid="wh-picker" onClick={() => onChange(null)}>{value ?? "boş"}</button>
  ),
}));

const view = (problem: string | null = null) => ({
  data: { data: { warehouse: { id: "w1", code: "EMN", name: "Emanet Deposu", isActive: problem === null }, problem, emanetEnabled: true } },
});

beforeEach(() => {
  mocks.get.mockReset();
  mocks.put.mockReset();
  mocks.emanet = true;
});

describe("EmanetDefaultWarehouseSection", () => {
  it("§1 emanet kapalı: çizilmez, istek yok", () => {
    mocks.emanet = false;
    renderWithProviders(<EmanetDefaultWarehouseSection />);
    expect(screen.queryByTestId("emanet-default-warehouse-settings")).toBeNull();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("§2 kayıtlı depo çizilir; boşaltıp Kaydet → warehouseId:null", async () => {
    mocks.get.mockResolvedValue(view());
    mocks.put.mockResolvedValue({ data: { data: { warehouse: null, problem: null, emanetEnabled: true } } });
    renderWithProviders(<EmanetDefaultWarehouseSection />);
    expect((await screen.findByTestId("wh-picker")).textContent).toBe("w1");
    expect(mocks.get).toHaveBeenCalledWith("/api/feature-flags/emanet-default-warehouse");
    expect(screen.queryByTestId("emanet-default-warehouse-save")).toBeNull();
    fireEvent.click(screen.getByTestId("wh-picker"));
    fireEvent.click(screen.getByTestId("emanet-default-warehouse-save"));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/api/feature-flags/emanet-default-warehouse", { warehouseId: null }, { headers: {} }));
  });
  it("§3 kullanılamaz depo uyarı verir", async () => {
    mocks.get.mockResolvedValue(view('"Emanet Deposu" deposu pasif durumda.'));
    renderWithProviders(<EmanetDefaultWarehouseSection />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/pasif durumda/);
  });
});
