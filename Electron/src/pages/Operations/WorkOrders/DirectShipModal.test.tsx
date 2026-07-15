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

// Müşteri seçici + şube seçici stub'ları — gerçek picker/servisi çağırmadan seçim yaptırır.
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (v: string | null) => void;
  }) => (
    <button type="button" data-testid="pick-customer" onClick={() => onChange("cust1")}>
      {value ?? "müşteri seç"}
    </button>
  ),
}));
vi.mock("@/pages/Customers/BranchSelect", () => ({
  BranchSelect: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button type="button" data-testid="pick-branch" onClick={() => onChange("br1")}>
      şube
    </button>
  ),
}));

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
        { orderLineId: "ol1", orderId: "o1", orderNumber: "SIP-001", customerId: "cust1", customerName: "Müşteri A", branchId: null, branchName: null, itemCode: "PATOS", itemName: "Patos Kumaş", colorName: null, width: 250, quantity: 400, shippedQty: 0, remaining: 400, suggestedQty: 400, isWorkOrderLinked: true },
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
const pickCustomer = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByTestId("pick-customer"));

describe("DirectShipModal (fasondan sevk UI)", () => {
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

  it("sebep + müşteri zorunlu: ikisi de girilene kadar buton disabled", async () => {
    const user = userEvent.setup();
    render();
    const textarea = await screen.findByPlaceholderText(/Boyahane/i);
    const btn = screen.getByRole("button", { name: /Sevk Et/i });
    expect(btn).toBeDisabled();
    await user.type(textarea, "müşteriye gitti"); // yalnız sebep → hâlâ disabled (müşteri yok)
    expect(btn).toBeDisabled();
    await pickCustomer(user); // müşteri de seçilince aktif
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("tüm toplar seçili + müşteri + sipariş seç → directShip payload (rollIds+customerId+alloc)", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "müşteriye gitti");
    await pickCustomer(user);
    await user.click(within(screen.getByTestId("ship-orders")).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [dispatchId, payload] = directShip.mock.calls[0] as [
      string,
      { customerId: string; rollIds: string[]; completeWorkOrder: boolean; orderLineAllocations: { orderLineId: string; qty: number }[] },
    ];
    expect(dispatchId).toBe("d1");
    expect(payload.customerId).toBe("cust1");
    expect([...payload.rollIds].sort()).toEqual(["r1", "r2"]);
    expect(payload.completeWorkOrder).toBe(false);
    // Karşılanma OTOMATİK dolar: sevk edilen 500m, satır kalanı 400 → min = 400.
    expect(payload.orderLineAllocations).toEqual([{ orderLineId: "ol1", qty: 400 }]);
  });

  it("'iş emrini tamamla' toggle açılınca payload.completeWorkOrder=true + atlama uyarısı", async () => {
    const user = userEvent.setup();
    render();
    await user.type(await screen.findByPlaceholderText(/Boyahane/i), "fason son durak");
    await pickCustomer(user);
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
    await pickCustomer(user);
    await user.click(rollChecks()[1]!); // r2'yi çıkar
    expect(await screen.findByText(/1 top fasonda kalacak/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Sevk Et/i }));
    await waitFor(() => expect(directShip).toHaveBeenCalledTimes(1));
    const [, payload] = directShip.mock.calls[0] as [string, { rollIds: string[] }];
    expect(payload.rollIds).toEqual(["r1"]);
  });

  it("siparişler müşteri seçilmeden pasif: 'önce müşteri seçin' uyarısı", async () => {
    render();
    expect(await screen.findByText(/Önce müşteri seçin/i)).toBeInTheDocument();
    expect(screen.queryByTestId("ship-orders")).not.toBeInTheDocument();
  });

  it("zaten fasondan sevk edilmiş sevk → engel mesajı + onay yok", async () => {
    getDirectShipPreview.mockResolvedValue(previewData({ alreadyDirectShipped: true }));
    render();
    expect(await screen.findByText(/zaten fasondan sevk edilmiş/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sevk Et/i })).toBeDisabled();
  });
});
