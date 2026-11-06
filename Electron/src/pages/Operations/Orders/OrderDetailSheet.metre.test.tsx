// Yan panel "Sevk İlerlemesi" listedeki "Metre" sütunuyla AYNI metni yazar (`orderMetreParts`, panel 1.3.11).
// İptal kalemin sevk edilmemiş kısmı paydaya girmez; yalnız sevk edilen kısmı girer (sunucu cümlesiyle aynı).
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { OrderDetailSheet } from "./OrderDetailSheet";
import { orderMetreText } from "./order-cell-text";
import type { Order, OrderLine } from "./types";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => false }) }));
vi.mock("./service", () => ({ orderService: { getById: vi.fn(), manualClose: vi.fn() } }));
vi.mock("@/pages/Operations/Returns/service", () => ({ returnsService: { summaryForOrder: vi.fn(() => new Promise(() => {})) } }));
vi.mock("@/pages/Operations/WorkOrders/CoveragePanel", () => ({ CoveragePanel: () => null }));
vi.mock("./OrderShipmentsCard", () => ({ OrderShipmentsCard: () => null }));
vi.mock("./LinkedWorkOrdersCard", () => ({ LinkedWorkOrdersCard: () => null }));
vi.mock("./OrderNeredeCard", () => ({ OrderNeredeCard: () => null }));
vi.mock("@/components/RecordInfoButton", () => ({ RecordInfoButton: () => null }));

const line = (p: Partial<OrderLine>): OrderLine =>
  ({
    id: "l1",
    itemId: "x",
    colorId: null,
    quantity: 1000,
    shippedQty: 0,
    unit: "MT",
    width: null,
    unitPrice: null,
    customerItemName: null,
    customerColorName: null,
    cutNote: null,
    cancelledAt: null,
    item: { id: "x", code: "X", name: "X Kumaş" },
    color: null,
    ...p,
  }) as unknown as OrderLine;

const order = (shippedQty: number, lines: OrderLine[]): Order =>
  ({ id: "o1", orderNumber: "SIP-1", status: "PARTIAL_SHIPPED", shippedQty, customerId: "c1", customer: { id: "c1", name: "A" }, lines, createdAt: "", updatedAt: "" }) as unknown as Order;

describe("OrderDetailSheet — Sevk İlerlemesi metresi", () => {
  it("listedeki Metre sütunuyla aynı metin (binlik ayraç, %)", async () => {
    const o = order(1200, [line({ quantity: 1000 }), line({ id: "l2", quantity: 1400 })]);
    renderWithProviders(<OrderDetailSheet order={o} open onOpenChange={() => {}} />);
    const label = await screen.findByText("Sevk İlerlemesi");
    expect(label.nextElementSibling?.textContent).toBe(orderMetreText(o));
    expect(label.nextElementSibling?.textContent).toBe("1.200 / 2.400 m (%50)");
  });

  it("iptal kalemin yalnız sevk edilen kısmı paydaya girer", async () => {
    const o = order(1240, [
      line({ quantity: 1200, shippedQty: 1200 }),
      line({ id: "x", quantity: 800, shippedQty: 40, cancelledAt: "2026-11-02T00:00:00Z" }),
    ]);
    renderWithProviders(<OrderDetailSheet order={o} open onOpenChange={() => {}} />);
    const label = await screen.findByText("Sevk İlerlemesi");
    expect(label.nextElementSibling?.textContent).toBe("1.240 / 1.240 m (%100)");
  });

  it("ölçülü kalemi olmayan siparişte ilerleme kartı çizilmez", async () => {
    renderWithProviders(<OrderDetailSheet order={order(0, [line({ unit: "KG" })])} open onOpenChange={() => {}} />);
    expect(await screen.findByText("X Kumaş")).toBeInTheDocument();
    expect(screen.queryByText("Sevk İlerlemesi")).toBeNull();
  });
});
