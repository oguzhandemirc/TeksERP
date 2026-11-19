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

describe("OrderLinksV3 açık metraj (MEASURED_LINE ikizi)", () => {
  it("MT satır → 'Açık <kalan>' (unit yoksa da metre)", () => {
    renderWithProviders(<OrderLinksV3 wo={wo([{ ...linkWithOrder, orderLine: { ...linkWithOrder.orderLine, shippedQty: 40 } }])} />);
    expect(screen.getByText(/Açık 60/)).toBeInTheDocument();
  });
  it("KG satır → 'Açık ölçülmüyor' (metreye düşülmez, rakam basılmaz)", () => {
    renderWithProviders(
      <OrderLinksV3 wo={wo([{ ...linkWithOrder, orderLine: { ...linkWithOrder.orderLine, unit: "KG" } }])} />,
    );
    expect(screen.getByText(/Açık ölçülmüyor/)).toBeInTheDocument();
    expect(screen.queryByText(/Açık 100/)).not.toBeInTheDocument();
  });
});

describe("OrderLinksV3 paylaştırma çipi ve toplamı", () => {
  function woAlloc(links: unknown[], allocation?: WorkOrder["allocation"]): WorkOrder {
    return { type: "ORDER_PRODUCTION", orderLinks: links, allocation } as unknown as WorkOrder;
  }

  it("allocatedQty > 0 → 'Paylaştırılan N m' çipi; 0 → çip yok", () => {
    renderWithProviders(
      <OrderLinksV3
        wo={woAlloc([
          { ...linkWithOrder, allocatedQty: "60" },
          { ...linkWithOrder, orderLineId: "l3", allocatedQty: 0 },
        ])}
      />,
    );
    expect(screen.getAllByText(/Paylaştırılan 60 m/)).toHaveLength(1);
    expect(screen.queryByText(/Paylaştırılan 0 m/)).not.toBeInTheDocument();
  });

  it("toplam satırı sunucu özetinden: tavan + paylaştırılan + kalan", () => {
    renderWithProviders(
      <OrderLinksV3
        wo={woAlloc([{ ...linkWithOrder, allocatedQty: 60 }], {
          basis: 100,
          basisKind: "INPUT",
          allocated: 60,
          remaining: 40,
        })}
      />,
    );
    const row = screen.getByTestId("allocation-total");
    expect(row).toHaveTextContent("Giren 100 m");
    expect(row).toHaveTextContent("Paylaştırılan 60 m");
    expect(row).toHaveTextContent("Kalan 40 m");
  });

  it("paylaştırma yoksa (allocated 0) toplam satırı basılmaz; aşımda 'fazla' gösterilir", () => {
    const { unmount } = renderWithProviders(
      <OrderLinksV3 wo={woAlloc([linkWithOrder], { basis: 100, basisKind: "TARGET", allocated: 0, remaining: 100 })} />,
    );
    expect(screen.queryByTestId("allocation-total")).not.toBeInTheDocument();
    unmount();
    renderWithProviders(
      <OrderLinksV3 wo={woAlloc([linkWithOrder], { basis: 100, basisKind: "TARGET", allocated: 110, remaining: -10 })} />,
    );
    expect(screen.getByTestId("allocation-total")).toHaveTextContent("10 m fazla");
  });
});
