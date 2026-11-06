// Cari kartı "müşterideki kumaş adı" seçicisi hizmet kalemini listelemez (Gülkesim 2026-11-06): kumaş seçici sunucuya
// stok türlerini (`STOCK_ITEM_TYPES`) CSV gönderir, süzme sunucuda. Negatif sonda (kırmızı görüldü): `extraFilters`
// kaldırılınca vaka ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { CustomerItemAliasesPanel } from "./CustomerItemAliasesPanel";
import { itemService } from "@/pages/Items/service";
import { customerAliasService } from "./aliasService";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./aliasService", () => ({
  customerAliasService: { listItemAliases: vi.fn(), upsertItemAlias: vi.fn(), deleteItemAlias: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(customerAliasService.listItemAliases).mockResolvedValue({ success: true, data: [] } as never);
});

describe("CustomerItemAliasesPanel kumaş seçici", () => {
  it("listeyi yalnız stok türleriyle ister — hizmet kalemi sunucuda süzülür", async () => {
    const getAll = vi.spyOn(itemService, "getAll").mockResolvedValue({ success: true, data: [] } as never);
    renderWithProviders(<CustomerItemAliasesPanel customerId="c1" />);
    await userEvent.click(await screen.findByText("Kumaş seç..."));
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    for (const [params] of getAll.mock.calls) {
      expect(params?.filters).toEqual(expect.objectContaining({ itemType: "YARN,FABRIC,CONSUMABLE" }));
    }
  });
});
