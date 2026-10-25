// Ürün kartı → Maliyet kartı bağlantısı yalnız KUMAŞ + modül açık + cost:read iken çizilir.
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";

let enabled = true;
let perms: string[] = ["cost:read"];
vi.mock("@/hooks/usePricingEnabled", () => ({ useMaliyetEnabled: () => enabled }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
import { ItemCostLink } from "./ItemCostLink";

describe("ItemCostLink", () => {
  beforeEach(() => { enabled = true; perms = ["cost:read"]; });
  it("kumaş + modül + izin → /cost/items/<id>", () => {
    renderWithProviders(<ItemCostLink itemId="i1" itemType="FABRIC" />);
    expect(screen.getByRole("link", { name: /Maliyet kartı/ })).toHaveAttribute("href", "/cost/items/i1");
  });
  it.each([
    ["kumaş değil", () => {}, "YARN"],
    ["modül kapalı", () => { enabled = false; }, "FABRIC"],
    ["izin yok", () => { perms = []; }, "FABRIC"],
  ])("%s → bağlantı yok", (_l, arrange, type) => {
    arrange();
    renderWithProviders(<ItemCostLink itemId="i1" itemType={type} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
