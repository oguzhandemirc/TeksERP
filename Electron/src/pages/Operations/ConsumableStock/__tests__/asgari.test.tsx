// Asgari stok uyarısı (Sarf Stoğu): rozet sunucunun `belowMinStock` kararından çizilir (istemci eşik kıyaslamaz),
// "Asgari altı" filtresi süzmeyi SUNUCUYA `belowMin` ile bırakır, özet şeridi faceted sayıyı yazar.
// Negatif sonda: hücre `below` yerine eşik varlığına bakınca §1 (eşikli ama üstündeki satır rozetli) kırmızı.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ConsumableStockPage } from "../ConsumableStockPage";
import { listConsumableStock } from "../service";

vi.mock("@/providers/PreferencesProvider", () => ({ useOptionalPreferences: () => null, usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listConsumableStock: vi.fn(async () => ({
    enabled: true,
    rows: [
      { itemId: "i1", code: "KSK-01", name: "Kuşak", unit: "ADET", balance: "4.000", negative: false, isActive: true, minStockQty: "10.000", belowMinStock: true },
      { itemId: "i2", code: "KRS-01", name: "Kurşun", unit: "KG", balance: "50.000", negative: false, isActive: true, minStockQty: "20.000", belowMinStock: false },
      { itemId: "i3", code: "ETK-01", name: "Etiket", unit: "ADET", balance: "0.000", negative: false, isActive: true, minStockQty: null, belowMinStock: false },
    ],
    summary: { itemCount: 3, negativeCount: 0, belowMinCount: 1 },
  })),
}));

describe("Sarf Stoğu asgari stok uyarısı", () => {
  it("§1 rozet yalnız sunucunun asgari altı dediği satırda; eşik sütunda birimiyle", async () => {
    renderWithProviders(<ConsumableStockPage />);
    expect(await screen.findByText("10 adet")).toBeInTheDocument();
    expect(screen.getByText("20 kg")).toBeInTheDocument();
    const badges = screen.getAllByText("Asgari altı", { selector: "div" });
    expect(badges).toHaveLength(1);
  });

  it("§2 özet şeridi asgari altı sayısını yazar", async () => {
    renderWithProviders(<ConsumableStockPage />);
    const band = await screen.findByLabelText("Sarf stoğu özeti");
    expect(band.textContent).toMatch(/Asgari altı\s*1/);
  });

  it("§3 filtre süzmeyi sunucuya bırakır (belowMin)", async () => {
    renderWithProviders(<ConsumableStockPage />);
    await screen.findByText("Kuşak");
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(vi.mocked(listConsumableStock)).toHaveBeenLastCalledWith({ search: "", belowMin: true }));
  });
});
