// İE varsayılan stok kartı: kayıtlı kart çizilir, "Temizle → Kaydet" uca null yazar, kullanılamaz kart uyarı verir;
// form ipucu yardımcısı kullanılamaz kartı "geçer" saymaz (aksi hâlde form boş hedefi gönderir, sunucu 409 verir).
// Negatif sonda: `defaultTargetHint`te `usable: false` → `true` yapılınca 4. vaka kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { defaultTargetHint } from "@/pages/Operations/WorkOrders/defaultTargetItem";
import { WorkOrderDefaultItemSection } from "./WorkOrderDefaultItemSection";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/services/apiClient", () => ({ default: { get: mocks.get, put: mocks.put } }));
vi.mock("@/lib/settings-password", () => ({ withSettingsPassword: (fn: (h: Record<string, string>) => unknown) => fn({}) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ isLoading: false, data: { data: { productionEnabled: true } } }) }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));

const card = (problem: string | null = null) => ({ id: "i1", code: "K-1", name: "Ham Tül", problem });
const reply = (wo: ReturnType<typeof card> | null) => ({ data: { data: { item: wo, source: wo ? "WORK_ORDER" : null, workOrderDefault: wo } } });

beforeEach(() => { mocks.get.mockReset(); mocks.put.mockReset(); });

describe("WorkOrderDefaultItemSection", () => {
  it("kayıtlı kart çizilir; Temizle → Kaydet uca itemId:null yazar", async () => {
    mocks.get.mockResolvedValue(reply(card()));
    mocks.put.mockResolvedValue({ data: { data: null } });
    renderWithProviders(<WorkOrderDefaultItemSection />);
    expect(await screen.findByText("Ham Tül — K-1")).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledWith("/work-orders/default-target-item");
    fireEvent.click(screen.getByLabelText("Varsayılan stok kartını temizle"));
    fireEvent.click(screen.getByTestId("wo-default-item-save"));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/work-orders/default-target-item", { itemId: null }, { headers: {} }));
  });

  it("kayıtlı kart kullanılamıyorsa uyarı çizilir", async () => {
    mocks.get.mockResolvedValue(reply(card("Ürün pasif.")));
    renderWithProviders(<WorkOrderDefaultItemSection />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Ürün pasif/);
  });

  it("ayar boşsa düğme boş yazar, kaydet yok", async () => {
    mocks.get.mockResolvedValue(reply(null));
    renderWithProviders(<WorkOrderDefaultItemSection />);
    expect(await screen.findByText("Kart seç (boş)")).toBeTruthy();
    expect(screen.queryByTestId("wo-default-item-save")).toBeNull();
  });
});

describe("defaultTargetHint", () => {
  it("kullanılabilir kart ipucu, kullanılamaz kart uyarı (geçmez), boşsa null", () => {
    expect(defaultTargetHint({ item: card(), source: "WORK_ORDER", workOrderDefault: card() })).toEqual({ text: "Boş bırakılırsa: Ham Tül", usable: true });
    expect(defaultTargetHint({ item: card("pasif"), source: "WORK_ORDER", workOrderDefault: card("pasif") })?.usable).toBe(false);
    expect(defaultTargetHint({ item: null, source: null, workOrderDefault: null })).toBeNull();
    expect(defaultTargetHint(undefined)).toBeNull();
  });
});
