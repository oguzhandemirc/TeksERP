// =============================================================================
// BEKÇİ — sipariş sayfası "Deverecide tutulan iplik" + iade + iadeler + aktarma + aktarma stornosu (D6b-2)
// =============================================================================
//   ① Tutma satırları plandaki iplik adıyla çizilir; İade/Aktar yalnız Sevkte/Tamamlandı + `warping-order:write`.
//   ② İade: kg önce tutmayla dolu, sebepsiz düğme kapalı; gövde kalem + kg + sebep kodu.
//   ③ İadeler: geri alınan satır eylemsiz; engelli satırda "Geri al" kapalı.
//   ④ Aktarma: önizlemesiz Aktar kapalı; önizleme etkilenen kalemi listeler; token mantıksal deneme başına.
//   ⑤ Aktarma stornosu önizlemedeki her kalemi listeler; engelde sebep kutusu yok, düğme kapalı.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D6b-2".
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder } from "./types";
import type { WarpingTransferBatch, WarpingYarnHolding, WarpingYarnReturnRow } from "./holding-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const svc = vi.hoisted(() => ({
  holdings: vi.fn(), returns: vi.fn(), returnYarn: vi.fn(), cancelReturn: vi.fn(), transfers: vi.fn(), transferPreview: vi.fn(), transfer: vi.fn(), transferCancelPreview: vi.fn(), transferCancel: vi.fn(),
}));
vi.mock("./holding-service", () => ({
  warpingHoldingService: svc,
  useWarpingHoldings: (id: string) => useQuery({ queryKey: ["wh-test", "h", id], queryFn: () => svc.holdings(id) }),
  useWarpingReturns: (id: string) => useQuery({ queryKey: ["wh-test", "r", id], queryFn: () => svc.returns(id) }),
  useWarpingTransfers: (id: string) => useQuery({ queryKey: ["wh-test", "t", id], queryFn: () => svc.transfers(id) }),
}));
vi.mock("./yarn-service", () => ({ useWarpingDispatches: () => ({ data: [] }) }));
vi.mock("@/pages/ReasonPresets/service", () => ({
  reasonPresetService: { list: vi.fn(async () => [{ kind: "YARN_SUBCONTRACT_RETURN", code: "KALAN", label: "Kalan iplik", isActive: true }, { kind: "WARP_RETURN", code: "X", label: "Başka tür", isActive: true }]) },
}));
vi.mock("@/hooks/useWarehouses", () => ({ useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [], isLoading: false }) }));
vi.mock("@/services/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/services/apiClient")>()),
  default: { get: vi.fn(async () => ({ data: { data: [{ id: "wo-2", orderNo: "FDV2", status: "OPEN", warpSpec: { code: "CZ", name: "Kart" }, expectedReturnAt: null }] } })) },
}));

import { HoldingsSection } from "./HoldingsSection";

const order = (status: WarpingOrder["status"] = "IN_PROGRESS") => ({
  id: "wo-1", orderNo: "FDV1", status, subcontractor: { id: "s1", code: "S", name: "Devereci A" }, yarns: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X" }],
}) as unknown as WarpingOrder;
const holding = (over: Partial<WarpingYarnHolding> = {}): WarpingYarnHolding => ({
  dispatchItemId: "i1", dispatchId: "d1", dispatchNo: "FS1", dispatchedAt: "2026-11-18T08:00:00Z", ownWarpingOrderId: "wo-1", own: true, yarnItemId: "y1",
  lotId: "L1", lotNo: "L-501", ownerCustomerId: null, outKg: "30.000", returnedKg: "0.000", transferInKg: "0.000", transferOutKg: "8.000", holdingKg: "22.000", ...over,
});
const ret = (over: Partial<WarpingYarnReturnRow> = {}): WarpingYarnReturnRow => ({
  movementId: "m1", createdAt: "2026-11-18T09:00:00Z", dispatchItemId: "i1", dispatchId: "d1", dispatchNo: "FS1", ownDispatch: true, yarnItemId: "y1", yarnItemCode: "IPL-5X",
  yarnItemName: "5X", warehouseId: "w1", warehouseName: "Merkez Depo", lotId: "L1", lotNo: "L-501", qtyKg: "5.000", reasonCode: "KALAN", reasonLabel: "Kalan iplik", note: null,
  status: "ACTIVE", canCancel: true, cancelBlockedReason: null, ...over,
});
const batch: WarpingTransferBatch = {
  batchId: "b1", kind: "TRANSFER", fromWarpingOrderId: "wo-1", fromOrderNo: "FDV1", toWarpingOrderId: "wo-2", toOrderNo: "FDV2", createdAt: "2026-11-18T10:00:00Z", note: null,
  totalKg: "8.000", cancelled: false, cancelBatchId: null,
  rows: [{ transferId: "t1", kind: "TRANSFER", dispatchItemId: "i1", dispatchNo: "FS1", yarnItemId: "y1", code: "IPL-5X", lotId: "L1", lotNo: "L-501", qtyKg: "8.000", reversesId: null }],
};
const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

function reset() {
  setPerms(["warping-order:read", "warping-order:write"]);
  Object.values(svc).forEach((f) => f.mockReset());
  svc.holdings.mockResolvedValue([holding()]);
  svc.returns.mockResolvedValue([]);
  svc.transfers.mockResolvedValue([]);
}

describe("HoldingsSection — tutma ve iade", () => {
  beforeEach(reset);

  it("① tutma satırı + yazma yüzeyi durum ve izinle", async () => {
    const { unmount } = renderWithProviders(<HoldingsSection order={order()} />);
    expect(await screen.findByText("IPL-5X")).toBeTruthy();
    expect(screen.getByText("−8,000")).toBeTruthy();
    expect(screen.getByRole("button", { name: "IPL-5X FS1 iade al" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Başka siparişe aktar/ })).toBeTruthy();
    unmount();
    const r2 = renderWithProviders(<HoldingsSection order={order("OPEN")} />);
    expect(await screen.findByText("IPL-5X")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /iade al/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Başka siparişe aktar/ })).toBeNull();
    r2.unmount();
    setPerms(["warping-order:read"]);
    renderWithProviders(<HoldingsSection order={order()} />);
    expect(await screen.findByText("IPL-5X")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /iade al/ })).toBeNull();
  });

  it("② iade: kg dolu, sebepsiz kapalı, gövde kalem + kg + sebep", async () => {
    svc.returnYarn.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    renderWithProviders(<HoldingsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "IPL-5X FS1 iade al" }));
    const dlg = await screen.findByRole("dialog");
    const kg = within(dlg).getByLabelText(/İade kg/) as HTMLInputElement;
    expect(kg.value).toBe("22");
    const save = within(dlg).getByRole("button", { name: "İadeyi kaydet" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(within(dlg).queryByText("Başka tür")).toBeNull();
    await user.click(await within(dlg).findByRole("radio", { name: "Kalan iplik" }));
    await user.clear(kg);
    await user.type(kg, "5,5");
    await user.click(save);
    await waitFor(() => expect(svc.returnYarn).toHaveBeenCalledWith("wo-1", { dispatchItemId: "i1", qtyKg: 5.5, reasonCode: "KALAN" }));
  });

  it("③ iadeler: geri alınan eylemsiz, engelli satırda Geri al kapalı", async () => {
    svc.returns.mockResolvedValue([ret(), ret({ movementId: "m2", canCancel: false, cancelBlockedReason: "levente sarılmış" }), ret({ movementId: "m3", status: "CANCELLED", canCancel: false })]);
    renderWithProviders(<HoldingsSection order={order()} />);
    const buttons = await screen.findAllByRole("button", { name: "IPL-5X iadesini geri al" });
    expect(buttons).toHaveLength(2);
    expect((buttons[0] as HTMLButtonElement).disabled).toBe(false);
    expect((buttons[1] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[1]!.getAttribute("title")).toBe("levente sarılmış");
    expect(screen.getByText("Geri alındı")).toBeTruthy();
  });

});

describe("HoldingsSection — aktarma", () => {
  beforeEach(reset);

  it("④ aktarma: önizlemesiz kapalı; önizleme listeler; token mantıksal deneme başına", async () => {
    svc.transferPreview.mockResolvedValue({ allocations: [{ dispatchItemId: "i1", dispatchNo: "FS1", yarnItemId: "y1", lotId: "L1", lotNo: "L-501", ownerCustomerId: null, qtyKg: "3.500" }], totalKg: "3.500", ownerCustomerId: null });
    const tokens: string[] = [];
    const err4xx = Object.assign(new Error("400"), { response: { status: 400, data: {} } });
    const errNet = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    svc.transfer.mockImplementation((_id: string, b: { clientToken: string }) => { tokens.push(b.clientToken); return Promise.reject(tokens.length === 1 ? err4xx : errNet); });
    const user = userEvent.setup();
    renderWithProviders(<HoldingsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: /Başka siparişe aktar/ }));
    const dlg = await screen.findByRole("dialog");
    await user.click(within(dlg).getByRole("button", { name: "Hedef sipariş seç" }));
    await user.click(await screen.findByRole("option", { name: /FDV2/ }));
    await user.type(within(dlg).getByLabelText("IPL-5X FS1 aktarılacak kg"), "3,5");
    const send = () => within(dlg).getByRole("button", { name: /^Aktar/ }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    await user.click(within(dlg).getByRole("button", { name: "Önizle" }));
    expect(await within(dlg).findByText(/IPL-5X · FS1 · lot L-501 — 3,500 kg FDV2 siparişine sayılır/)).toBeTruthy();
    expect(svc.transferPreview).toHaveBeenCalledWith("wo-1", { toWarpingOrderId: "wo-2", lines: [{ yarnItemId: "y1", qtyKg: 3.5, lotId: "L1", dispatchItemId: "i1" }], note: null });
    for (let i = 1; i <= 3; i++) {
      await user.click(send());
      await waitFor(() => expect(tokens.length).toBe(i));
    }
    expect(tokens[1]).not.toBe(tokens[0]);
    expect(tokens[2]).toBe(tokens[1]);
  });

  it("⑤ aktarma stornosu her kalemi listeler; engelde sebep kutusu yok", async () => {
    svc.transfers.mockResolvedValue([batch]);
    svc.transferCancelPreview.mockResolvedValue({ batch, canCancel: false, blockedReason: "Hedef aktarılanı artık tutmuyor.", items: [{ dispatchItemId: "i1", dispatchNo: "FS1", code: "IPL-5X", lotNo: "L-501", qtyKg: "8.000", targetHoldsKg: "2.000" }] });
    const user = userEvent.setup();
    renderWithProviders(<HoldingsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "FDV1 → FDV2 aktarmasını iptal et" }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(/IPL-5X · FS1 · lot L-501 — 8,000 kg geri döner \(hedef bugün 2,000 kg tutuyor\)/)).toBeTruthy();
    expect(within(dlg).getByText(/artık tutmuyor/)).toBeTruthy();
    expect(within(dlg).queryByLabelText(/İptal sebebi/)).toBeNull();
    expect((within(dlg).getByRole("button", { name: "Aktarmayı iptal et" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
