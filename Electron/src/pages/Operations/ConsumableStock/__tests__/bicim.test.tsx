// Prova-2: Sarf Stoğu ekranında tarih fabrika diliminde "gg.aa.yyyy SS:dd", miktar program sayı biçiminde
// (ondalık virgül, gereksiz sıfır yok, binlik ayıracı yok — lib/format kuralı), kapalı bayrak ipucu GERÇEK ayar yolunu söyler.
// Negatif sonda: Sheet'te factoryLocaleString'e / sayfada ham `r.balance`a dönülünce §1/§2 kırmızı.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { flagSettingTrail } from "@/lib/flag-setting-path";
import { ConsumableStockPage } from "../ConsumableStockPage";

vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: { density: "comfortable" }, setPreference: vi.fn() }) }));
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  listConsumableStock: vi.fn(async () => ({
    enabled: false,
    rows: [{ itemId: "i1", code: "KSK-01", name: "Kuşak", unit: "adet", balance: "5000.000", negative: false, isActive: true }],
    summary: { itemCount: 1, negativeCount: 0 },
  })),
  listConsumableMovements: vi.fn(async () => ({
    item: { id: "i1", name: "Kuşak", unit: "adet" },
    rows: [{
      id: "m1", kind: "RECEIPT_IN", signedQty: "5000.000", reason: null, createdAt: "2026-11-01T12:48:00.000Z",
      reversed: false, isReversal: false, receipt: { id: "r1", receiptNo: "MK-1" }, roll: null, workOrder: null, operationType: null,
    }, {
      id: "m2", kind: "CONSUMPTION_OUT", signedQty: "-12.500", reason: null, createdAt: "2026-11-01T13:00:00.000Z",
      reversed: false, isReversal: false, receipt: null, roll: null, workOrder: null, operationType: null,
    }],
    nextCursor: null,
  })),
}));

describe("Sarf Stoğu biçimleri (prova-2)", () => {
  it("§1 bakiye '5000.000' → '5000 adet' (sondaki sıfırlar yok)", async () => {
    renderWithProviders(<ConsumableStockPage />);
    expect(await screen.findByText("5000 adet")).toBeInTheDocument();
    expect(screen.queryByText(/5000\.000/)).toBeNull();
  });

  it("§2 hareket tarihi fabrika diliminde '01.11.2026 15:48', miktar virgüllü", async () => {
    renderWithProviders(<ConsumableStockPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hareketler" }));
    expect(await screen.findByText("01.11.2026 15:48")).toBeInTheDocument();
    expect(screen.getByText("-12,5")).toBeInTheDocument();
    expect(screen.queryByText(/PM|AM|11\/1\/2026/)).toBeNull();
  });

  it("§3 kapalı bayrak ipucu ayar kaydındaki yolu söyler (Sistem → Özellik Anahtarları → …)", async () => {
    renderWithProviders(<ConsumableStockPage />);
    const trail = flagSettingTrail("consumableStockEnabled");
    expect(trail).toMatch(/^Sistem → Özellik Anahtarları → /);
    expect(await screen.findByText(new RegExp(trail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeInTheDocument();
    expect(screen.queryByText(/Ayarlar › Mal Kabul/)).toBeNull();
  });
});
