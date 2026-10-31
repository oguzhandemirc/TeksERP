// D4-F1c — İade Girişi: müşteri kendi barkoduyla iade eder; belirsiz kod → aday modalı → iç barkodla aynı okutma.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SHARED_CODE, ambiguousThen } from "@/test/helpers/musteri-kodu-aday-fikstur";

const lookup = vi.fn();
vi.mock("./service", () => ({
  returnsService: { lookup: (c: string) => lookup(c), lookupSack: vi.fn(), lookupShipment: vi.fn(), lookupLot: vi.fn(), create: vi.fn(), createBatch: vi.fn() },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true, hasPermission: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useReturnGradingEnabled: () => false }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: vi.fn(async () => ({ data: [] })) }));
vi.mock("./ReturnLotPicker", () => ({ ReturnLotPicker: () => null }));
vi.mock("./ShipmentReturnPicker", () => ({ ShipmentReturnPicker: () => null }));
import { ReturnEntryDialog } from "./ReturnEntryDialog";

const found = (code: string) => ({
  success: true,
  data: {
    roll: { id: `id-${code}`, barcode: code, item: null, color: null, width: null, currentQty: 20, qualityGrade: null, qualityGradeRef: null },
    shipment: { id: "s", shipmentNo: "SVK-IADE", dispatchedAt: null }, customer: null, branch: null, candidateOrders: [], returnGradingEnabled: false,
  },
});

function open(initialBarcode: string) {
  render(<QueryClientProvider client={new QueryClient()}><ReturnEntryDialog open onOpenChange={() => {}} initialBarcode={initialBarcode} /></QueryClientProvider>);
}

beforeEach(() => {
  lookup.mockReset();
  lookup.mockImplementation(ambiguousThen(found));
});

describe("İade Girişi — belirsiz müşteri kodu", () => {
  it("409 → modal → seçim → iç barkodla aynı okutma", async () => {
    open(SHARED_CODE);
    fireEvent.click(await screen.findByTestId("customer-code-candidate-r-b"));
    expect(await screen.findByText("SVK-IADE")).toBeTruthy();
    expect(lookup.mock.calls.map((c) => c[0])).toEqual([SHARED_CODE, "T-IC-B"]);
  });

  it("Vazgeç → kapsam kurulmaz, ikinci istek yok", async () => {
    open(SHARED_CODE);
    fireEvent.click(await screen.findByRole("button", { name: "Vazgeç" }));
    await waitFor(() => expect(screen.queryByTestId("customer-code-candidate-r-a")).toBeNull());
    expect(screen.queryByText("SVK-IADE")).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("tekil kod → modal açılmaz", async () => {
    open("T-IC-A");
    expect(await screen.findByText("SVK-IADE")).toBeTruthy();
    expect(screen.queryByTestId("customer-code-candidate-r-a")).toBeNull();
  });
});
