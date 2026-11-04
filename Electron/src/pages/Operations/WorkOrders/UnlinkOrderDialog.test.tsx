import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { UnlinkOrderDialog } from "./UnlinkOrderDialog";
import { LAST_LINK_REASON } from "./unlink-order";
import type { WorkOrder } from "./types";

const unlinkOrderLine = vi.fn();
vi.mock("./service", () => ({ workOrderService: { unlinkOrderLine: (...a: unknown[]) => unlinkOrderLine(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn() } }));

const link = (id: string, colorId: string, colorName: string) => ({
  orderLineId: id,
  allocatedQty: 0,
  orderLine: {
    quantity: 100,
    shippedQty: 0,
    unit: "MT",
    width: null,
    colorId,
    order: { id: `o-${id}`, orderNumber: `SP-${id}`, status: "APPROVED", customer: { id: "c", code: "C", name: "Acme" } },
    item: { id: "i", name: "Saten" },
    color: { id: colorId, code: colorId, name: colorName, hex: null },
  },
});

const wo = (p: Partial<WorkOrder>) =>
  ({
    id: "wo1",
    workOrderNumber: "IE-1",
    status: "IN_PROGRESS",
    type: "ORDER_PRODUCTION",
    targetItemId: "i",
    targetColorId: null,
    orderLinks: [link("a", "red", "Kırmızı"), link("b", "blue", "Mavi"), link("c", "blue", "Mavi")],
    ...p,
  }) as unknown as WorkOrder;

const box = (id: string) => screen.getByRole("checkbox", { name: `SP-${id} seç` });

describe("UnlinkOrderDialog", () => {
  beforeEach(() => unlinkOrderLine.mockReset().mockResolvedValue({ success: true, data: { removed: true } }));

  it("bağlı kalemleri listeler, birden çok seçilir ve seçilenler koparılır", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<UnlinkOrderDialog open onOpenChange={onOpenChange} wo={wo({ targetColorId: "x" })} onSuggestColor={vi.fn()} />);
    expect(screen.getByText("SP-a")).toBeInTheDocument();
    expect(screen.getAllByText("Acme")).toHaveLength(3);
    expect(screen.getAllByText("100 m")).toHaveLength(3);
    fireEvent.click(box("a"));
    fireEvent.click(box("b"));
    fireEvent.click(screen.getByRole("button", { name: /Bağı Kopar \(2\)/ }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(unlinkOrderLine.mock.calls).toEqual([["wo1", "a"], ["wo1", "b"]]);
  });

  it("hedef kumaş boşken son bağ pasif ve gerekçesi yazılı", () => {
    renderWithProviders(
      <UnlinkOrderDialog open onOpenChange={vi.fn()} wo={wo({ targetItemId: null, orderLinks: [link("a", "red", "Kırmızı")] } as Partial<WorkOrder>)} onSuggestColor={vi.fn()} />,
    );
    expect(box("a")).toBeDisabled();
    expect(screen.getByText(LAST_LINK_REASON)).toBeInTheDocument();
  });

  it("hedef kumaş boşken çoklu seçimde en az bir bağ kalır", () => {
    renderWithProviders(<UnlinkOrderDialog open onOpenChange={vi.fn()} wo={wo({ targetItemId: null })} onSuggestColor={vi.fn()} />);
    fireEvent.click(box("a"));
    fireEvent.click(box("b"));
    expect(box("c")).toBeDisabled();
    expect(screen.getByText(LAST_LINK_REASON)).toBeInTheDocument();
  });

  it("kalan tek renk + hedef renk boş → öneri; onayla renk akışı o renkle açılır", async () => {
    const onSuggestColor = vi.fn();
    renderWithProviders(<UnlinkOrderDialog open onOpenChange={vi.fn()} wo={wo({})} onSuggestColor={onSuggestColor} />);
    fireEvent.click(box("a"));
    fireEvent.click(screen.getByRole("button", { name: /Bağı Kopar \(1\)/ }));
    expect(await screen.findByText(/Kalan sipariş Mavi; .* rengi Mavi yapılsın mı\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Evet/ }));
    expect(onSuggestColor).toHaveBeenCalledWith("blue");
  });

  it("kalanlar karışık renkse öneri gösterilmez, diyalog kapanır", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<UnlinkOrderDialog open onOpenChange={onOpenChange} wo={wo({})} onSuggestColor={vi.fn()} />);
    fireEvent.click(box("b"));
    fireEvent.click(screen.getByRole("button", { name: /Bağı Kopar \(1\)/ }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/yapılsın mı/)).toBeNull();
  });
});
