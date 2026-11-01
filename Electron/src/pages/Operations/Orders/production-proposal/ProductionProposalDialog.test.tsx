import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { Order } from "../types";
import type { ProductionProposal } from "./types";

const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("./service", () => ({ productionProposalService: api }));
const flags = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: flags.value } }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

import { ProductionProposalDialog } from "./ProductionProposalDialog";
import { ProductionProposalButton } from "./ProductionProposalButton";

const proposal: ProductionProposal = {
  orderId: "o1",
  orderNumber: "SIP1",
  weavingOrders: [{ key: "W|i1|-", itemId: "i1", itemName: "Tül A", recipeId: null, warpSpecId: null, weftSpecId: null, weaveDesignId: null, shrinkPct: 10, plannedM: 1111.111, orderLines: [{ orderLineId: "l1", openM: 1000, allocatedM: 1000 }] }],
  workOrders: [{ key: "WO|a", itemId: "i1", itemName: "Tül A", colorId: null, width: 280, routeId: "r", foldType: null, targetQuantity: 1000, orderLines: [{ orderLineId: "l1", allocatedQty: 1000 }], blockedCode: null }],
  excluded: [{ orderLineId: "l2", kind: "LINE", code: "ORDER_LINE_ALREADY_PLANNED" }],
  canCreate: { weaving: true, workOrder: true },
};
const order = { id: "o1", orderNumber: "SIP1", status: "APPROVED", lines: [] } as unknown as Order;

beforeEach(() => {
  api.preview.mockReset().mockResolvedValue(proposal);
  api.apply.mockReset();
  flags.value = { orderProductionProposal: "ONIZLEME", productionEnabled: true, dokumaEnabled: true };
});

describe("Üretime gönder (SY-M3)", () => {
  it("KAPALI'da düğme çizilmez ve önizleme isteği atılmaz", () => {
    flags.value = { orderProductionProposal: "KAPALI", productionEnabled: true, dokumaEnabled: true };
    renderWithProviders(<ProductionProposalButton order={order} />);
    expect(screen.queryByRole("button", { name: /Üretime gönder/ })).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("ONIZLEME'de düğme diyaloğu açar; her kayıt listelenir, dışarıda kalan nedenle yazılır", async () => {
    renderWithProviders(<ProductionProposalButton order={order} />);
    fireEvent.click(screen.getByRole("button", { name: /Üretime gönder/ }));
    expect(await screen.findByText(/Dokuma işleri \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Terbiye iş emirleri \(1\)/)).toBeTruthy();
    expect(screen.getByText(/zaten planlanmış/)).toBeTruthy();
  });

  it("per-kayıt seçim: işareti kaldırılan gövdeye girmez", async () => {
    api.apply.mockResolvedValue({ success: true, data: { weavingOrders: [{ id: "w1", number: "DK1" }], workOrders: [] } });
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /terbiye iş emrini seç/ }));
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await screen.findByText(/DK1/);
    const body = api.apply.mock.calls[0]?.[1];
    expect(body.workOrders).toEqual([]);
    expect(body.weavingOrders.map((w: { key: string }) => w.key)).toEqual(["W|i1|-"]);
  });

  it("409 cümlesi diyalogda kalır, Oluştur kapanır; yenileme yeni önizleme ister", async () => {
    api.apply.mockRejectedValue({ response: { status: 409, data: { message: "Seçilen sipariş satırlarından bazıları bu arada planlanmış — önizlemeyi yenileyin.", details: { code: "ORDER_LINE_ALREADY_PLANNED", orderLineIds: ["l1"] } } } });
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    await screen.findByText(/Dokuma işleri/);
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/bu arada planlanmış/);
    expect(screen.getByRole("button", { name: "Oluştur" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Önizlemeyi yenile" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
  });
});
