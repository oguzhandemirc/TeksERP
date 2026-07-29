import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({
  useOpenTarget: () => openTarget,
}));

import { OrderLinksV3 } from "./OrderLinksV3";
import type { WorkOrder } from "../types";

function wo(links: unknown[]): WorkOrder {
  return { type: "ORDER_PRODUCTION", orderLinks: links } as unknown as WorkOrder;
}
const linkWithOrder = {
  orderLineId: "l1",
  orderLine: {
    quantity: 100,
    shippedQty: 0,
    width: 150,
    item: { name: "Test Kumaş" },
    order: { id: "ord1", orderNumber: "SIP-1", customer: { name: "Müşteri A" } },
  },
};
const linkNoOrder = {
  orderLineId: "l2",
  orderLine: { quantity: 50, shippedQty: 0, item: { name: "X" }, order: null },
};

describe("OrderLinksV3 sipariş navigasyonu", () => {
  beforeEach(() => openTarget.mockReset());

  it("gerçek sipariş → başlık tıklanabilir, openTarget(?focus=)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderLinksV3 wo={wo([linkWithOrder])} />);
    const btn = screen.getByRole("button", { name: /SIP-1/ });
    await user.click(btn);
    expect(openTarget).toHaveBeenCalledTimes(1);
    expect(openTarget.mock.calls[0]?.[0]).toBe("/operations/orders?focus=ord1");
  });

  it("siparişsiz bağ → tıklanamaz (button yok)", () => {
    renderWithProviders(<OrderLinksV3 wo={wo([linkNoOrder])} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
