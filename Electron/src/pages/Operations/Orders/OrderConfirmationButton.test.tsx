// SY-3 L1: sipariş teyidi düğmesi — okuma izni sipariş uçlarıyla aynı (order:read | order:write), kaynak = sipariş.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const perms = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p), hasAnyPermission: (ps: string[]) => ps.some((p) => perms.list.includes(p)), hasAllPermissions: () => true }),
}));
const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("@/pages/Cost/shared/CommercialDocButton", () => ({
  CommercialDocButton: (p: Record<string, unknown>) => {
    seen.props = p;
    return <button type="button">{String(p.buttonLabel)}</button>;
  },
}));
import { OrderConfirmationButton } from "./OrderConfirmationButton";

const order = { id: "o1", orderNumber: "SIP-1", customer: { name: "Acme" } } as never;

describe("OrderConfirmationButton", () => {
  it("order:read ile görünür; tür ORDER_CONFIRMATION, kaynak sipariş, taslak yok", () => {
    perms.list = ["order:read"];
    renderWithProviders(<OrderConfirmationButton order={order} />);
    expect(screen.getByRole("button", { name: "Sipariş teyidi" })).toBeInTheDocument();
    expect(seen.props).toMatchObject({ docType: "ORDER_CONFIRMATION", sourceId: "o1", draft: false, label: "Sipariş SIP-1 · Acme" });
  });
  it("sipariş izni yoksa çizilmez", () => {
    perms.list = ["shipping:read"];
    renderWithProviders(<OrderConfirmationButton order={order} />);
    expect(screen.queryByRole("button", { name: "Sipariş teyidi" })).toBeNull();
  });
});
