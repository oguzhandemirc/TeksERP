// Ürün penceresi asgari stok uyarısı: sunucu "asgari altı" derse tek satır; demezse ya da modül/izin yoksa hiç
// sorulmaz/çizilmez (403 tostu çıkmasın). Negatif sonda: `canRead` kapısı sökülünce §3 (izinsizken istek) kırmızı.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ItemStockLevelNote } from "./ItemStockLevelNote";
import { listYarnStocks } from "@/pages/Operations/Yarn/service";
import { listConsumableStock } from "@/pages/Operations/ConsumableStock/service";

const access = { perms: ["warehouse:read", "goods-receipt:read"] };
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: {} } }) }));
vi.mock("@/lib/license/module-enabled", () => ({ isModuleEnabled: () => true }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => access.perms.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => access.perms.includes(p)),
  }),
}));
vi.mock("@/pages/Operations/Yarn/service", () => ({ listYarnStocks: vi.fn() }));
vi.mock("@/pages/Operations/ConsumableStock/service", () => ({ listConsumableStock: vi.fn() }));

beforeEach(() => {
  access.perms = ["warehouse:read", "goods-receipt:read"];
  vi.mocked(listYarnStocks).mockReset();
  vi.mocked(listConsumableStock).mockReset();
});

describe("ItemStockLevelNote", () => {
  it("§1 iplik: kalem toplamı asgari altıysa eldeki + eşik yazılır", async () => {
    vi.mocked(listYarnStocks).mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 1, total: 2, totalPages: 2 }, totals: { balanceKg: "90.000", belowMinItemCount: 1 } });
    renderWithProviders(<ItemStockLevelNote itemId="y1" itemType="YARN" unit="KG" minStockQty="100" />);
    expect(await screen.findByRole("status")).toHaveTextContent("Eldeki 90 kg — asgari stoğun (100 kg) altında");
    expect(vi.mocked(listYarnStocks)).toHaveBeenCalledWith({ page: 1, pageSize: 1, itemId: "y1" });
  });

  it("§2 sarf: sunucu asgari altı demiyorsa satır yok", async () => {
    vi.mocked(listConsumableStock).mockResolvedValue({
      enabled: true,
      rows: [{ itemId: "c1", code: "K", name: "Kuşak", unit: "ADET", balance: "10.000", negative: false, isActive: true, minStockQty: "10.000", belowMinStock: false }],
      summary: { itemCount: 1, negativeCount: 0, belowMinCount: 0 },
    });
    renderWithProviders(<ItemStockLevelNote itemId="c1" itemType="CONSUMABLE" unit="ADET" minStockQty="10" />);
    await waitFor(() => expect(vi.mocked(listConsumableStock)).toHaveBeenCalledWith({ itemId: "c1" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("§3 izin yoksa ya da eşik boşsa hiç sorulmaz", async () => {
    access.perms = ["goods-receipt:read"]; // iplik için warehouse:read gerekir
    renderWithProviders(<ItemStockLevelNote itemId="y1" itemType="YARN" unit="KG" minStockQty="100" />);
    renderWithProviders(<ItemStockLevelNote itemId="c1" itemType="CONSUMABLE" unit="ADET" minStockQty={null} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(listYarnStocks)).not.toHaveBeenCalled();
    expect(vi.mocked(listConsumableStock)).not.toHaveBeenCalled();
  });
});
