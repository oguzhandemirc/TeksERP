// BEKÇİ — Lotlar sekmesi: "Kalite: Tümü" süzgeci düz CSV query ile SUNUCUYA iner; rozet satırda; eski backend'de Serbest
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const listYarnLots = vi.fn();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useEmanetEnabled: () => false, useFeatureFlags: () => ({ data: undefined }) }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), listYarnLots: (...a: unknown[]) => listYarnLots(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { YarnLotsPanel } from "./YarnLotsPanel";

const lot = (id: string, lotNo: string, extra: Record<string, unknown> = {}) => ({ id, itemId: "i1", lotNo, supplierId: null, notes: null, isActive: true, item: { id: "i1", code: "IP1", name: "Ne 30" }, supplier: null, balanceKg: 10, createdAt: "", updatedAt: "", ...extra });

beforeEach(() => {
  listYarnLots.mockReset().mockResolvedValue({ success: true, data: [lot("a", "L-ESKI"), lot("b", "L-BLOKE", { qualityStatus: "BLOCKED", qualityNote: "rapor 18/09" })], pagination: { nextCursor: null, hasMore: false, limit: 50 } });
});

describe("YarnLotsPanel — kalite", () => {
  it("⭐ rozet: alanı olmayan lot Serbest, BLOCKED lot Bloke + not; süzgeç seçimi düz CSV ile sunucuya gider", async () => {
    const user = userEvent.setup();
    renderWithProviders(<YarnLotsPanel />);
    await screen.findByText("L-BLOKE");
    expect(listYarnLots).toHaveBeenLastCalledWith(expect.not.objectContaining({ qualityStatus: expect.anything() }));
    const rows = screen.getAllByRole("row");
    expect(rows.find((r) => r.textContent?.includes("L-ESKI"))).toHaveTextContent("Serbest");
    const blocked = rows.find((r) => r.textContent?.includes("L-BLOKE"))!;
    expect(blocked).toHaveTextContent("Bloke");
    expect(blocked).toHaveTextContent("rapor 18/09");
    await user.click(screen.getByRole("combobox", { name: "Kalite" }));
    await user.click(await screen.findByRole("option", { name: "Serbest + Bekletmede" }));
    await waitFor(() => expect(listYarnLots).toHaveBeenLastCalledWith(expect.objectContaining({ qualityStatus: "RELEASED,ON_HOLD" })));
  });
});
