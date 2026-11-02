// Genel Ayarlar → Gelen Belge: fabrika varsayılan rotası + rota önerisi önceliği (backend `suggestRoute` zincirinin
// iki ayarı). Eski backend alanları göndermez → boş + "Önce müşteri geçmişi"; yalnız değişen alan gönderilir.
// Negatif sonda: `useRouteDraft` gövdesini koşulsuz tüm alanlarla kurmak → "temizlenince null gider" kırmızı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { IncomingDocumentSettingsSection } from "@/pages/GeneralSettings/GelenBelgeSettingsSection";

const getSettings = vi.fn();
const updateSettings = vi.fn();
vi.mock("../service", () => ({
  INCOMING_DOCUMENT_SETTINGS_QUERY_KEY: ["gelen-belge", "ayarlar"],
  getIncomingDocumentSettings: () => getSettings(),
  updateIncomingDocumentSettings: (b: unknown) => updateSettings(b),
}));
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: { gelenBelgeEnabled: true } } }),
}));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));
// Rota seçici: değer görünür + tek tıkla "KURŞUN → TAMBUR-1" seçilir / temizlenir.
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <div>
      <span data-testid="route-value">{value ?? "boş"}</span>
      <button type="button" onClick={() => onChange("rt-kursun")}>Rota seç</button>
      <button type="button" onClick={() => onChange(null)}>Rota temizle</button>
    </div>
  ),
}));

const BASE = { defaultItem: null, unreviewedApproval: "WARN", defaultUnreviewedApproval: "WARN", autoWorkOrder: true };

describe("Genel Ayarlar → Gelen Belge: rota önerisi ayarları", () => {
  beforeEach(() => {
    getSettings.mockReset();
    updateSettings.mockReset();
  });

  it("⭐ eski backend alanları göndermez → rota boş + 'Önce müşteri geçmişi'; rota + 'Her zaman fabrika varsayılanı' seçilince YALNIZ bu iki alan gider", async () => {
    getSettings.mockResolvedValue(BASE);
    updateSettings.mockResolvedValue({ ...BASE, defaultRoute: { id: "rt-kursun", name: "KURŞUN → TAMBUR-1", problem: null }, routeSuggestionPriority: "FACTORY_FIRST", defaultRouteSuggestionPriority: "CUSTOMER_FIRST" });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByTestId("route-value")).toHaveTextContent("boş");
    expect(screen.getByRole("radio", { name: /Önce müşteri geçmişi/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Rota seç" }));
    await userEvent.click(screen.getByRole("radio", { name: /Her zaman fabrika varsayılanı/ }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toEqual({ defaultRouteTemplateId: "rt-kursun", routeSuggestionPriority: "FACTORY_FIRST" });
  });

  it("kayıtlı rota temizlenince null gider (bugünkü davranışa dönüş)", async () => {
    getSettings.mockResolvedValue({ ...BASE, defaultRoute: { id: "rt-kursun", name: "KURŞUN → TAMBUR-1", problem: null }, routeSuggestionPriority: "CUSTOMER_FIRST", defaultRouteSuggestionPriority: "CUSTOMER_FIRST" });
    updateSettings.mockResolvedValue(BASE);
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByTestId("route-value")).toHaveTextContent("rt-kursun");
    await userEvent.click(screen.getByRole("button", { name: "Rota temizle" }));
    await userEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(updateSettings.mock.calls[0]![0]).toEqual({ defaultRouteTemplateId: null });
  });

  it("kayıtlı rota pasifse uyarı bandı neden + rota adıyla görünür", async () => {
    getSettings.mockResolvedValue({ ...BASE, defaultRoute: { id: "rt-x", name: "Eski rota", problem: "Pasif bir rota şablonu kullanılamaz" }, routeSuggestionPriority: "FACTORY_FIRST", defaultRouteSuggestionPriority: "CUSTOMER_FIRST" });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Eski rota");
    expect(alert).toHaveTextContent("Pasif bir rota şablonu kullanılamaz");
  });

  it("'Her zaman fabrika varsayılanı' seçili ama rota boşsa ipucu yazılır", async () => {
    getSettings.mockResolvedValue({ ...BASE, defaultRoute: null, routeSuggestionPriority: "FACTORY_FIRST", defaultRouteSuggestionPriority: "CUSTOMER_FIRST" });
    renderWithProviders(<IncomingDocumentSettingsSection />);
    expect(await screen.findByText(/Fabrika varsayılan rotası boş; bu seçenek rota seçilene dek/)).toBeTruthy();
  });
});
