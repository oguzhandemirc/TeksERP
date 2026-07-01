import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const getDirectShipPreview = vi.fn();
const directShip = vi.fn();
vi.mock("./service", () => ({
  workOrderService: {
    getDirectShipPreview: (...a: unknown[]) => getDirectShipPreview(...a),
    directShip: (...a: unknown[]) => directShip(...a),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DirectShipModal } from "./DirectShipModal";

function previewData(over: Partial<Record<string, unknown>> = {}) {
  return {
    success: true,
    data: {
      dispatchId: "d1",
      dispatchNo: "SD2606000001",
      cancelled: false,
      alreadyDirectShipped: false,
      subcontractor: { id: "s1", name: "BOYER" },
      workOrder: { id: "wo1", batchNumber: "P-001", status: "IN_PROGRESS" },
      fasonStep: { id: "st1", stepSequence: 1, stationName: "Boyahane" },
      affectedRolls: [
        { id: "r1", barcode: "BC-1", currentQty: 300, weightKg: null, itemCode: "PATOS", itemName: "Patos Kumaş", colorName: null },
        { id: "r2", barcode: "BC-2", currentQty: 200, weightKg: null, itemCode: "PATOS", itemName: "Patos Kumaş", colorName: "Mavi" },
      ],
      downstreamStepsToSkip: [{ id: "st2", stepSequence: 2, stationName: "Tambur" }],
      otherAtSubcontractor: 0,
      woWillComplete: true,
      candidateOrderLines: [
        { orderLineId: "ol1", orderId: "o1", orderNumber: "SIP-001", itemCode: "PATOS", itemName: "Patos Kumaş", colorName: null, width: 250, quantity: 400, shippedQty: 0, remaining: 400, suggestedQty: 400, isWorkOrderLinked: true },
      ],
      ...over,
    },
  };
}

const render = () =>
  renderWithProviders(
    <DirectShipModal open onOpenChange={() => {}} workOrderId="wo1" dispatchId="d1" dispatchNo="SD2606000001" />,
  );

const rollChecks = () => within(screen.getByTestId("ship-rolls")).getAllByRole("checkbox");

describe("DirectShipModal (fasondan doğrudan sevk UI)", () => {
  beforeEach(() => {
    getDirectShipPreview.mockReset().mockResolvedValue(previewData());
    directShip.mockReset().mockResolvedValue({ success: true, data: { dispatchNo: "SD2606000001", consumedRollCount: 2 } });
  });

  it("önizlemeyi render eder: toplar (checkbox) + iş emrini tamamla toggle", async () => {
    render();
    expect(await screen.findByText(/Sevk edilecek toplar/i)).toBeInTheDocument();
    expect(screen.getByText("BC-1")).toBeInTheDocument();
    expect(screen.getByText("BC-2")).toBeInTheDocument();
    expect(rollChecks()).toHaveLength(2);
    // tüm toplar default seçili
    rollChecks().forEach((c) => expect(c).toBeChecked());
    expect(screen.getByText(/Bu iş emrini tamamla/i)).toBeInTheDocument();
    // toggle KAPALI iken "açık kalır" mesajı
    expect(screen.getByText(/iş emri AÇIK kalır/i)).toBeInTheDocument();
  });

  it("sebep boşken buton disabled; sebep girilince aktif", async () => {
    const user = userEvent.setup();
    render();
    const textarea = await screen.findByPlaceholderText(/Boyahane/i);
    const btn = screen.getByRole("button", { name: /Sevk Et/i });
    expect(btn).toBeDisabled();
    await user.type(textarea, "doğrudan sevk sebebi");
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("tüm toplar seçili + sipariş seç → directShip rollIds(tümü)+completeWorkOrder(false)+alloc", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "müşteriye gitti");
    await user.click(within(screen.getByTestId("ship-orders")).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [dispatchId, payload] = directShip.mock.calls[0] as [string, { reason: string; rollIds: string[]; completeWorkOrder: boolean; orderLineAllocations: { orderLineId: string; qty: number }[] }];
    expect(dispatchId).toBe("d1");
    expect([...payload.rollIds].sort()).toEqual(["r1", "r2"]);
    expect(payload.completeWorkOrder).toBe(false);
    expect(payload.orderLineAllocations).toEqual([{ orderLineId: "ol1", qty: 400 }]);
  });

  it("'iş emrini tamamla' toggle açılınca payload.completeWorkOrder=true + atlama uyarısı", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "fason son durak");
    await user.click(screen.getByRole("checkbox", { name: /İş emrini tamamla/i }));
    expect(await screen.findByText(/sonraki adım atlanacak/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sevk Et \+ WO/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [, payload] = directShip.mock.calls[0] as [string, { completeWorkOrder: boolean }];
    expect(payload.completeWorkOrder).toBe(true);
  });

  it("per-roll: bir top seçimden çıkarılınca rollIds yalnız seçili + uyarı", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "kısmi sevk");
    await user.click(rollChecks()[1]!); // r2'yi çıkar
    expect(await screen.findByText(/1 top fasonda kalacak/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [, payload] = directShip.mock.calls[0] as [string, { rollIds: string[] }];
    expect(payload.rollIds).toEqual(["r1"]);
  });

  it("zaten doğrudan sevk edilmiş sevk → engel mesajı + onay yok", async () => {
    getDirectShipPreview.mockResolvedValue(previewData({ alreadyDirectShipped: true }));
    render();
    expect(await screen.findByText(/zaten doğrudan sevk edilmiş/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sevk Et/i })).toBeDisabled();
  });
});
