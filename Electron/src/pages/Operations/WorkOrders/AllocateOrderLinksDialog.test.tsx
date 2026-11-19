import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const getById = vi.fn();
const setOrderLinkAllocations = vi.fn();
vi.mock("./service", () => ({
  workOrderService: { getById: (...a: unknown[]) => getById(...a) },
}));
vi.mock("./planning-service", () => ({
  workOrderPlanningService: {
    setOrderLinkAllocations: (...a: unknown[]) => setOrderLinkAllocations(...a),
  },
}));
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: (...a: unknown[]) => toastWarning(...a) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

import { AllocateOrderLinksDialog } from "./AllocateOrderLinksDialog";
import type { WorkOrder } from "./types";

const QTY: Record<string, number> = { a: 600, b: 800, k: 50 };
const link = (id: string, orderNumber: string, allocatedQty: string, unit = "MT") => ({
  orderLineId: id,
  allocatedQty,
  orderLine: {
    quantity: QTY[id] ?? 0,
    shippedQty: 0,
    unit,
    width: 150,
    colorId: null,
    item: { id: "i1", name: "Patos" },
    order: { id: `o-${id}`, orderNumber, status: "OPEN", customer: { id: "c", code: "C", name: `Firma ${orderNumber}` } },
  },
});

function makeWo(allocatedA = "0", allocatedB = "0"): WorkOrder {
  return {
    id: "wo1",
    workOrderNumber: "IE1611260001",
    status: "IN_PROGRESS",
    type: "ORDER_PRODUCTION",
    allocation: { basis: 1000, basisKind: "INPUT", allocated: 0, remaining: 1000 },
    orderLinks: [link("a", "SIP-X", allocatedA), link("b", "SIP-Y", allocatedB), link("k", "SIP-KG", "0", "KG")],
  } as unknown as WorkOrder;
}

async function renderDialog(wo = makeWo()) {
  getById.mockResolvedValue({ success: true, data: wo });
  renderWithProviders(<AllocateOrderLinksDialog open onOpenChange={() => {}} workOrder={wo} />);
  return { user: userEvent.setup(), x: await screen.findByLabelText("SIP-X paylaştırılan metre"), y: screen.getByLabelText("SIP-Y paylaştırılan metre") };
}

describe("AllocateOrderLinksDialog", () => {
  beforeEach(() => {
    getById.mockReset();
    setOrderLinkAllocations.mockReset();
    toastWarning.mockReset();
  });

  it("sunucu değeri METİN ('800.000') kutuya '800' olarak gelir; KG satırda kutu yok", async () => {
    const { x } = await renderDialog(makeWo("800.000", "0"));
    expect(x).toHaveValue("800");
    expect(screen.queryByLabelText("SIP-KG paylaştırılan metre")).not.toBeInTheDocument();
    expect(screen.getByText("metre dışı")).toBeInTheDocument();
  });

  it("önizleme: 800 + 200 → Giren 1000 · Paylaştırılan 1000 · Kalan 0; gövde yalnız MT satırları", async () => {
    setOrderLinkAllocations.mockResolvedValue({ success: true, data: { changed: 2, warnings: [], allocation: {} } });
    const { user, x, y } = await renderDialog();
    await user.type(x, "800");
    await user.type(y, "200");
    const bar = screen.getByTestId("allocation-summary");
    expect(bar).toHaveTextContent("Giren 1000 m");
    expect(bar).toHaveTextContent("Paylaştırılan 1000 m");
    expect(bar).toHaveTextContent("Kalan 0 m");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(setOrderLinkAllocations).toHaveBeenCalledTimes(1));
    expect(setOrderLinkAllocations.mock.calls[0]).toEqual([
      "wo1",
      [
        { orderLineId: "a", allocatedQty: 800 },
        { orderLineId: "b", allocatedQty: 200 },
      ],
    ]);
  });

  it("aşım önizlemede kırmızı; sunucu 400 ALLOCATION_OVER_BASIS → diyalogda 'kalan' cümlesi", async () => {
    setOrderLinkAllocations.mockRejectedValue({
      response: {
        status: 400,
        data: { message: "x", details: { code: "ALLOCATION_OVER_BASIS", basis: 1000, basisKind: "INPUT", allocated: 1100, remaining: -100 } },
      },
    });
    const { user, x, y } = await renderDialog();
    await user.type(x, "800");
    await user.type(y, "300");
    expect(screen.getByTestId("allocation-summary")).toHaveTextContent("100 m fazla");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(
      await screen.findByText("Paylaştırılan toplam, iş emrine giren metreyi aşıyor (kalan 1000 m)."),
    ).toBeInTheDocument();
  });

  it("sunucu uyarısı (sipariş açığını aşma) sarı tost olarak basılır — engel değil", async () => {
    setOrderLinkAllocations.mockResolvedValue({
      success: true,
      data: { changed: 1, warnings: ["SIP-X: paylaştırılan 700 m, siparişin açığı 600 m."], allocation: {} },
    });
    const { user, x } = await renderDialog();
    await user.type(x, "700");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith("SIP-X: paylaştırılan 700 m, siparişin açığı 600 m.", expect.anything()));
  });

  it("geçersiz biçim ('1.000') Kaydet'i kapatır, istek gitmez", async () => {
    const { user, x } = await renderDialog();
    await user.type(x, "1.000");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    expect(setOrderLinkAllocations).not.toHaveBeenCalled();
  });
});
