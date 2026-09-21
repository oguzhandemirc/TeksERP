// İade Girişi — SEVK PARTİSİ kapsamı uçtan uca (jsdom): çip → parti seçici → iki sevkiyat grubu
// → özet "2 iade belgesi" → neden → İade Al → `createBatch` yükü (grup başına sipariş; aday
// olmayan grupta null). Sunucu ve seçiciler mock; pencerenin kendi kararları ölçülür.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const lot = {
  lot: { id: "L", name: "SP-3" }, customer: null, returnGradingEnabled: false,
  groups: [
    { shipment: { id: "A", shipmentNo: "SVKA", dispatchedAt: null }, customer: { id: "c", code: "C", name: "BOTAN" }, branch: null,
      sacks: [{ id: "s1", sackNo: "CV1", packageNo: 1, packingGroupName: "SP-3", rolls: [{ id: "a1", barcode: "T1", item: { id: "i", code: "I", name: "Poplin" }, color: null, width: 150, currentQty: 50, qualityGrade: "A", qualityGradeRef: null }] }],
      orders: [{ id: "o1", orderNumber: "O-1", status: "APPROVED", deadline: null, rollIds: ["a1"] }] },
    { shipment: { id: "B", shipmentNo: "SVKB", dispatchedAt: null }, customer: null, branch: null,
      sacks: [{ id: "s2", sackNo: "CV2", packageNo: 2, packingGroupName: "SP-3", rolls: [{ id: "b1", barcode: "T2", item: null, color: null, width: null, currentQty: 20, qualityGrade: "A", qualityGradeRef: null }] }],
      orders: [] },
  ],
};
vi.mock("./service", () => ({
  returnsService: {
    lookup: vi.fn(), lookupSack: vi.fn(),
    lookupShipment: vi.fn(async () => ({ success: true, data: { ...lot.groups[0], returnGradingEnabled: false } })),
    lookupLot: vi.fn(async () => ({ success: true, data: lot })),
    create: vi.fn(async () => ({ success: true, data: { id: "r", rollId: "a1", appliedStatus: "WAREHOUSE", rollCount: 1 } })),
    createBatch: vi.fn(async () => ({ success: true, data: { done: [{ returnGroupId: "x", rollCount: 1, appliedStatus: "WAREHOUSE" }, { returnGroupId: "y", rollCount: 1, appliedStatus: "WAREHOUSE" }], failed: null, skipped: 0, rollCount: 2 }, message: "İade alındı — 2 top, 2 iade belgesi" })),
  },
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasAnyPermission: () => true, hasPermission: () => true }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useReturnGradingEnabled: () => false }));
vi.mock("@/lib/picker-loader", () => ({ loadAllForPicker: vi.fn(async () => ({ data: [{ id: "rs", name: "Hatalı", isActive: true }] })) }));
vi.mock("./ReturnLotPicker", () => ({ ReturnLotPicker: (p: { open: boolean; onPick: (id: string) => void }) => (p.open ? <button onClick={() => p.onPick("L")}>PICK-LOT</button> : null) }));
vi.mock("./ShipmentReturnPicker", () => ({ ShipmentReturnPicker: () => null }));
import { ReturnEntryDialog } from "./ReturnEntryDialog";
import { returnsService } from "./service";
describe("İade Girişi — sevk partisi kapsamı", () => {
  it("parti → iki sevkiyat → sevkiyat başına belge (createBatch)", async () => {
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}><ReturnEntryDialog open onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByText("Sevk partisi"));
    fireEvent.click(await screen.findByText("PICK-LOT"));
    expect(await screen.findByText("SVKA")).toBeTruthy();
    expect(screen.getByText("SVKB")).toBeTruthy();
    expect(screen.getByText(/2 iade belgesi/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Açıklama (katalog seçmediysen yaz)"), { target: { value: "hatalı" } });
    const btn = screen.getByRole("button", { name: /İade Al/ });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(returnsService.createBatch).toHaveBeenCalledTimes(1));
    const payload = (returnsService.createBatch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as { groups: { rollIds: string[]; orderId: string | null }[] };
    expect(payload.groups).toEqual([{ rollIds: ["a1"], orderId: "o1" }, { rollIds: ["b1"], orderId: null }]);
  });
});
