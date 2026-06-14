import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

// Servisi mock'la — gerçek HTTP yok.
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
      dispatchNo: "SD-2606-000001",
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
    <DirectShipModal open onOpenChange={() => {}} workOrderId="wo1" dispatchId="d1" dispatchNo="SD-2606-000001" />,
  );

describe("DirectShipModal (fasondan doğrudan sevk UI)", () => {
  beforeEach(() => {
    getDirectShipPreview.mockReset().mockResolvedValue(previewData());
    directShip.mockReset().mockResolvedValue({ success: true, data: { dispatchNo: "SD-2606-000001", consumedRollCount: 2 } });
  });

  it("önizleme verisini render eder: top sayısı + atlanacak adım + WO tamamlanacak rozeti", async () => {
    render();
    // "2" ayrı <span>'de → bölünmemiş metin parçasıyla eşleştir.
    expect(await screen.findByText(/top tüketilecek/i)).toBeInTheDocument();
    expect(screen.getByText(/Sonraki/i)).toBeInTheDocument();
    expect(screen.getByText(/Tambur/)).toBeInTheDocument();
    expect(screen.getByText(/İş emri TAMAMLANACAK/i)).toBeInTheDocument();
    // somut top listesi
    expect(screen.getByText("BC-1")).toBeInTheDocument();
    expect(screen.getByText("BC-2")).toBeInTheDocument();
  });

  it("sebep boşken buton disabled; sebep girilince aktif", async () => {
    const user = userEvent.setup();
    render();
    // Önce önizleme yüklensin (textarea render olsun) — footer butonu hep var.
    const textarea = await screen.findByPlaceholderText(/Boyahane/i);
    const btn = screen.getByRole("button", { name: /Doğrudan Sevk Et/i });
    expect(btn).toBeDisabled();
    await user.type(textarea, "doğrudan sevk sebebi");
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("sipariş seçip onaylayınca directShip reason + allocations ile çağrılır", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "müşteriye gitti");
    // aday satırı seç (checkbox) → qty suggestedQty(400) ile prefill
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Doğrudan Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [dispatchId, payload] = directShip.mock.calls[0] as [string, { reason: string; orderLineAllocations: { orderLineId: string; qty: number }[] }];
    expect(dispatchId).toBe("d1");
    expect(payload.reason).toBe("müşteriye gitti");
    expect(payload.orderLineAllocations).toEqual([{ orderLineId: "ol1", qty: 400 }]);
  });

  it("karşılanma seçilmezse directShip boş allocations ile çağrılır (yalnız WO kapanır)", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "karşılanma yok");
    await user.click(screen.getByRole("button", { name: /Doğrudan Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [, payload] = directShip.mock.calls[0] as [string, { orderLineAllocations: unknown[] }];
    expect(payload.orderLineAllocations).toEqual([]);
  });

  it("woWillComplete=false ise 'iş emri açık kalacak' uyarısı gösterilir", async () => {
    getDirectShipPreview.mockResolvedValue(previewData({ woWillComplete: false, otherAtSubcontractor: 2 }));
    render();
    expect(await screen.findByText(/İş emri açık kalacak/i)).toBeInTheDocument();
  });

  it("zaten doğrudan sevk edilmiş sevk → engel mesajı + onay yok", async () => {
    getDirectShipPreview.mockResolvedValue(previewData({ alreadyDirectShipped: true }));
    render();
    expect(await screen.findByText(/zaten doğrudan sevk edilmiş/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Doğrudan Sevk Et/i });
    expect(btn).toBeDisabled();
  });
});
