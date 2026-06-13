import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Servisleri mock'la — gerçek HTTP yok.
const getAll = vi.fn();
const retargetOrders = vi.fn();
vi.mock("@/pages/Operations/Orders/service", () => ({
  orderService: { getAll: (...a: unknown[]) => getAll(...a) },
}));
vi.mock("./service", () => ({
  shipmentService: { retargetOrders: (...a: unknown[]) => retargetOrders(...a) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { RetargetOrdersDialog } from "./RetargetOrdersDialog";

const orders = {
  success: true,
  data: [
    { id: "o1", orderNumber: "SIP-001", deadline: null },
    { id: "o2", orderNumber: "SIP-002", deadline: null },
    { id: "o3", orderNumber: "SIP-003", deadline: null },
  ],
  pagination: { total: 3, page: 1, pageSize: 200, totalPages: 1 },
};

describe("RetargetOrdersDialog (saha #7 yeniden hedefleme UI)", () => {
  beforeEach(() => {
    getAll.mockReset().mockResolvedValue(orders);
    retargetOrders.mockReset().mockResolvedValue({ success: true, message: "Yeniden hedeflendi" });
  });

  it("müşteri açık siparişlerini listeler, mevcut bağlı pre-checked", async () => {
    renderWithProviders(
      <RetargetOrdersDialog
        shipmentId="s1"
        customerId="c1"
        branchId={null}
        currentOrderIds={["o1"]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByText("SIP-001")).toBeInTheDocument();
    expect(screen.getByText("SIP-003")).toBeInTheDocument();
    // başlangıçta 1 seçili (o1)
    expect(screen.getByText("1 sipariş seçili")).toBeInTheDocument();
  });

  it("seçim değiştir + Hedefle → retargetOrders seçili id'lerle çağrılır", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RetargetOrdersDialog
        shipmentId="s1"
        customerId="c1"
        branchId={null}
        currentOrderIds={["o1"]}
        open
        onOpenChange={() => {}}
      />,
    );
    await screen.findByText("SIP-002");
    await user.click(screen.getByText("SIP-002")); // o2 ekle (o1 zaten seçili)
    await user.click(screen.getByRole("button", { name: /Hedefle/i }));
    await waitFor(() => expect(retargetOrders).toHaveBeenCalledTimes(1));
    const [shipmentId, ids] = retargetOrders.mock.calls[0];
    expect(shipmentId).toBe("s1");
    expect([...ids].sort()).toEqual(["o1", "o2"]);
  });

  it("müşteri açık siparişi yoksa bilgi mesajı", async () => {
    getAll.mockResolvedValue({ ...orders, data: [], pagination: { ...orders.pagination, total: 0 } });
    renderWithProviders(
      <RetargetOrdersDialog
        shipmentId="s1"
        customerId="c1"
        branchId={null}
        currentOrderIds={[]}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByText(/açık sipariş yok/i)).toBeInTheDocument();
  });
});
