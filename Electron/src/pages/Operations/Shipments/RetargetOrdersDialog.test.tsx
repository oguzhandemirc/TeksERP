import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Sipariş numarası artık hem seçim listesinde hem projeksiyon tablosunda görünür —
// liste içi sorguları bu bölgeye sınırla (çift eşleşme olmasın).
const list = () => within(screen.getByTestId("retarget-order-list"));

// Servisleri mock'la — gerçek HTTP yok.
const getAll = vi.fn();
const retargetOrders = vi.fn();
const retargetPreview = vi.fn();
vi.mock("@/pages/Operations/Orders/service", () => ({
  orderService: { getAll: (...a: unknown[]) => getAll(...a) },
}));
vi.mock("./service", () => ({
  shipmentService: {
    retargetOrders: (...a: unknown[]) => retargetOrders(...a),
    retargetPreview: (...a: unknown[]) => retargetPreview(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Saha #7 önizleme yanıtı kurucu — seçili id'lere göre projeksiyon üretir.
function previewResponse(opts: {
  orders: { orderId: string; orderNumber: string; planned: number; projected: number; coveragePct: number }[];
  leftover?: number;
  goods?: number;
}) {
  const projectedTotal = opts.orders.reduce((s, o) => s + o.projected, 0);
  const goods = opts.goods ?? projectedTotal + (opts.leftover ?? 0);
  return {
    success: true,
    data: {
      editable: true,
      orders: opts.orders.map((o) => ({ ...o, alreadyShipped: 0 })),
      totals: { goods, projectedTotal, leftover: opts.leftover ?? 0 },
      ignored: [],
    },
  };
}

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
    retargetPreview.mockReset().mockResolvedValue(
      previewResponse({
        orders: [{ orderId: "o1", orderNumber: "SIP-001", planned: 100, projected: 100, coveragePct: 100 }],
      }),
    );
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
    expect(await list().findByText("SIP-001")).toBeInTheDocument();
    expect(list().getByText("SIP-003")).toBeInTheDocument();
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
    await list().findByText("SIP-002");
    await user.click(list().getByText("SIP-002")); // o2 ekle (o1 zaten seçili)
    await user.click(screen.getByRole("button", { name: /Hedefle/i }));
    await waitFor(() => expect(retargetOrders).toHaveBeenCalledTimes(1));
    const firstCall = retargetOrders.mock.calls[0] ?? [];
    const shipmentId = firstCall[0] as string;
    const ids = (firstCall[1] ?? []) as string[];
    expect(shipmentId).toBe("s1");
    expect([...ids].sort()).toEqual(["o1", "o2"]);
  });

  it("seçim değişince SALT-OKUNUR projeksiyon render edilir (planlanan + kapsama%)", async () => {
    const user = userEvent.setup();
    // o1 seçili açılış → ilk projeksiyon. o2 eklenince yeni projeksiyon.
    retargetPreview.mockImplementation((_id: string, ids: string[]) => {
      if (ids.length >= 2) {
        return Promise.resolve(
          previewResponse({
            orders: [
              { orderId: "o1", orderNumber: "SIP-001", planned: 100, projected: 100, coveragePct: 100 },
              { orderId: "o2", orderNumber: "SIP-002", planned: 100, projected: 50, coveragePct: 50 },
            ],
          }),
        );
      }
      return Promise.resolve(
        previewResponse({
          orders: [{ orderId: "o1", orderNumber: "SIP-001", planned: 100, projected: 100, coveragePct: 100 }],
        }),
      );
    });

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
    await list().findByText("SIP-002");

    // İlk projeksiyon (o1 tek): %100 görünür, projeksiyon paneli mevcut.
    await waitFor(() =>
      expect(screen.getByTestId("retarget-projection")).toHaveTextContent("%100"),
    );

    // o2 ekle → debounced preview yeni id kümesiyle çağrılır → kısmi %50 render.
    await user.click(list().getByText("SIP-002"));
    await waitFor(() =>
      expect(screen.getByTestId("retarget-projection")).toHaveTextContent("%50"),
    );
    // En son preview çağrısı iki sipariş içermeli (artımlı yeniden hesap).
    await waitFor(() => {
      const lastCall = retargetPreview.mock.calls.at(-1);
      const lastIds = (lastCall?.[1] ?? []) as string[];
      expect([...lastIds].sort()).toEqual(["o1", "o2"]);
    });
  });

  it("artan (leftover) > 0 ise fazla mal uyarısı gösterilir", async () => {
    retargetPreview.mockResolvedValue(
      previewResponse({
        orders: [{ orderId: "o1", orderNumber: "SIP-001", planned: 100, projected: 100, coveragePct: 100 }],
        goods: 150,
        leftover: 50,
      }),
    );
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
    expect(await screen.findByText(/Fazla mal/i)).toBeInTheDocument();
  });

  it("hiç sipariş seçili değilse preview çağrılmaz, bilgi metni gösterilir", async () => {
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
    expect(await screen.findByText(/Projeksiyon için en az bir sipariş seç/i)).toBeInTheDocument();
    // Seçim boş → backend'e istek atılmaz.
    expect(retargetPreview).not.toHaveBeenCalled();
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
