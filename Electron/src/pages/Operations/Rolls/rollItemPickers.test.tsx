// Top/sevk kumaş seçicileri hizmet kalemini listelemez: top yalnız kumaştan doğar (backend `ROLL_BEARING_ITEM_TYPES`),
// seçici sunucuya `itemType=FABRIC` gönderir, süzme sunucuda. Negatif sonda (kırmızı görüldü): `extraFilters`
// kaldırılınca / `itemType` silinince ilgili vaka ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { itemService } from "@/pages/Items/service";
import { customerService } from "@/pages/Customers/service";
import { colorService } from "@/pages/Colors/service";
import { QuickShipDialog } from "./QuickShipDialog";
import { ManualEntryDialog } from "./ManualEntryDialog";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const empty = { success: true, data: [] } as never;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(customerService, "getAll").mockResolvedValue(empty);
  vi.spyOn(colorService, "getAll").mockResolvedValue(empty);
  // ReferenceSelect listeyi mount'ta ister — casus render'dan ÖNCE kurulur.
  vi.spyOn(itemService, "getAll").mockResolvedValue(empty);
});

async function itemFiltersAfterOpen(): Promise<Array<Record<string, unknown> | undefined>> {
  const getAll = vi.mocked(itemService.getAll);
  await userEvent.click(await screen.findByText("Kumaş ara..."));
  await waitFor(() => expect(getAll).toHaveBeenCalled());
  return getAll.mock.calls.map(([params]) => params?.filters as Record<string, unknown> | undefined);
}

describe("top/sevk kumaş seçicileri", () => {
  it("Hızlı Sevk miktar modu yalnız kumaş ister", async () => {
    renderWithProviders(<QuickShipDialog open onOpenChange={() => {}} />);
    for (const f of await itemFiltersAfterOpen()) expect(f).toEqual(expect.objectContaining({ itemType: "FABRIC" }));
  });

  it("Manuel stok girişi yalnız aktif kumaş ister", async () => {
    renderWithProviders(<ManualEntryDialog open onOpenChange={() => {}} />);
    for (const f of await itemFiltersAfterOpen()) {
      expect(f).toEqual(expect.objectContaining({ itemType: "FABRIC", lifecycleStatus: "ACTIVE" }));
    }
  });
});
