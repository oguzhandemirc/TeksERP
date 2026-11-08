// =============================================================================
// BEKÇİ — Kalem Fiyatları konu seçimi (D2): Ürün / Hizmet ayrı modal, kart doğru uçtan okunur
// =============================================================================
// ⭐ Hizmet türü seçilince HİZMET seçicisi açılır; seçilen kart `/api/service-items/:id`ten okunur (ürün ucu hizmeti
//    artık döndürmez) ve panel hizmet kipinde (`isService`) açılır.
// ⭐ Bulucu listesindeki hizmet fiyat satırı (`serviceItemId` dolu) tıklanınca hizmet kipinde açılır.
// NEGATİF SONDA (2026-11-08, geri alındı): `priceSubjectOfRow` hep PRODUCT dönünce §2 kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const itemGetById = vi.fn();
const serviceGetById = vi.fn();
const listItemPrices = vi.fn();
vi.mock("@/pages/Items/service", () => ({ itemService: { getById: (...a: unknown[]) => itemGetById(...a) } }));
vi.mock("@/pages/Definitions/Services/service", () => ({ serviceItemService: { getById: (...a: unknown[]) => serviceGetById(...a) } }));
vi.mock("./service", () => ({ listItemPrices: (...a: unknown[]) => listItemPrices(...a) }));
vi.mock("./useItemPricesAccess", () => ({
  useItemPricesAccess: () => ({ visible: true, editable: true, isLoading: false, ticaretEnabled: true, canRead: true, canWrite: true }),
}));
vi.mock("./ItemPricesPanel", () => ({
  ItemPricesPanel: (p: { itemId: string; itemLabel: string; unit: string | null; isService: boolean }) => (
    <div data-testid="panel" data-item={p.itemId} data-service={String(p.isService)} data-unit={p.unit ?? ""}>
      {p.itemLabel}
    </div>
  ),
}));
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" data-testid="item-select" onClick={() => onChange("itm-1")}>Ürün seç</button>
  ),
}));
vi.mock("@/components/forms/ServiceItemSelect", () => ({
  ServiceItemSelect: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" data-testid="service-select" onClick={() => onChange("svc-1")}>Hizmet seç</button>
  ),
}));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));

import { ItemPricesPage } from "./ItemPricesPage";

const SERVICE = { data: { id: "svc-1", code: "HZM-000001", name: "Kurşun dikimi", unit: "MT" } };
const PRODUCT = { data: { id: "itm-1", code: "STK-000001", name: "PATOS", unit: "MT" } };

beforeEach(() => {
  vi.clearAllMocks();
  itemGetById.mockResolvedValue(PRODUCT);
  serviceGetById.mockResolvedValue(SERVICE);
  listItemPrices.mockResolvedValue({ data: [], pagination: { total: 0 } });
});

describe("Kalem Fiyatları konu seçimi (D2)", () => {
  it("⭐ §1 Hizmet türü → hizmet seçicisi; kart hizmet ucundan okunur, panel hizmet kipinde", async () => {
    renderWithProviders(<ItemPricesPage />);
    expect(screen.getByTestId("item-select")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Hizmet" }));
    expect(screen.queryByTestId("item-select")).toBeNull();
    fireEvent.click(screen.getByTestId("service-select"));
    await waitFor(() => expect(screen.getByTestId("panel").textContent).toBe("HZM-000001 — Kurşun dikimi"));
    expect(serviceGetById).toHaveBeenCalledWith("svc-1");
    expect(itemGetById).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel").getAttribute("data-service")).toBe("true");
  });

  it("⭐ §2 bulucudaki hizmet fiyat satırı hizmet kipinde açılır; ürün satırı ürün kipinde", async () => {
    listItemPrices.mockResolvedValue({
      data: [
        { id: "p1", itemId: "svc-1", serviceItemId: "svc-1", customerId: null, item: { id: "svc-1", code: "HZM-000001", name: "Kurşun dikimi" } },
        { id: "p2", itemId: "itm-1", serviceItemId: null, customerId: null, item: { id: "itm-1", code: "STK-000001", name: "PATOS" } },
      ],
      pagination: { total: 2 },
    });
    renderWithProviders(<ItemPricesPage />);
    fireEvent.click(await screen.findByText("HZM-000001 — Kurşun dikimi"));
    await waitFor(() => expect(screen.getByTestId("panel").getAttribute("data-service")).toBe("true"));
    expect(serviceGetById).toHaveBeenCalledWith("svc-1");
    expect(screen.getByRole("radio", { name: "Hizmet" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByText("Başka kart seç"));
    fireEvent.click(await screen.findByText("STK-000001 — PATOS"));
    await waitFor(() => expect(screen.getByTestId("panel").getAttribute("data-service")).toBe("false"));
    expect(itemGetById).toHaveBeenCalledWith("itm-1");
  });
});
