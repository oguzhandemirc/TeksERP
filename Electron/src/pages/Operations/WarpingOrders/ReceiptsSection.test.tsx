// =============================================================================
// BEKÇİ — sipariş sayfası "Dönen leventler ve mutabakat" + levent kabulü + kabul geri alma (D7a)
// =============================================================================
//   ① Mutabakat (metre + iplik başına) ve kabul satırları sunucudan çizilir; "Levent kabulü" yalnız OPEN/IN_PROGRESS + `warping-order:write`.
//   ② Kabul: satırlar plandan dolu; önizlemesiz "Kabul et" kapalı; önizleme tüketim/devir/etkilenen kalemi gösterir;
//      girdi değişince kapanır; gövde satır başına metre/gövde/tartı; token mantıksal deneme başına.
//   ③ Geri alma önizlemedeki her leventi listeler; engelde sunucunun cümlesi, sebep kutusu yok, düğme kapalı.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D7a".
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder } from "./types";
import type { WarpingReceipt, WarpingReceivePreview, WarpingSettlement } from "./receive-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const svc = vi.hoisted(() => ({ receipts: vi.fn(), receivePreview: vi.fn(), receive: vi.fn(), cancelPreview: vi.fn(), cancel: vi.fn() }));
vi.mock("./receive-service", () => ({
  warpingReceiveService: svc,
  useWarpingReceipts: (id: string) => useQuery({ queryKey: ["wr-test", id], queryFn: () => svc.receipts(id) }),
}));

vi.mock("./rejection-service", () => ({ warpingRejectionService: {}, useWarpingRejections: () => ({ data: undefined, isSuccess: false, isError: false }) }));
// E2: sipariş sayfasındaki kabul artık dönüş kabul belgesi ucuna gider (tek siparişlik özel hal).
const docSvc = vi.hoisted(() => ({ preview: vi.fn(), create: vi.fn(), byDeliveryNote: vi.fn(), resolveBody: vi.fn(), get: vi.fn(), listCursor: vi.fn() }));
vi.mock("./receive-doc-service", async (orig) => ({
  ...(await orig<typeof import("./receive-doc-service")>()),
  warpingReceiveDocService: docSvc,
  useDeliveryNoteGroup: () => ({ data: undefined }),
}));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), listWarpingOrders: () => Promise.resolve({ success: true, data: [], pagination: { nextCursor: null, hasMore: false, limit: 100 }, summary: null }) }));
vi.mock("@/components/forms/SubcontractorCategoryPicker", () => ({ SubcontractorCategoryPicker: () => null }));

import { ReceiptsSection } from "./ReceiptsSection";

const order = (status: WarpingOrder["status"] = "IN_PROGRESS") => ({
  id: "wo-1", orderNo: "FDV1", status, subcontractor: { id: "s1", code: "S", name: "Devereci A" },
  warpSpec: { id: "ws1", code: "CK1", name: "Tül zemin" }, targetLengthM: "1000.000", beamCount: 2,
  beamLines: [{ beamCount: 2, beamLengthM: "500.000" }], yarns: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X" }],
}) as unknown as WarpingOrder;

const settlement: WarpingSettlement = {
  metre: { targetM: "1000.000", receivedM: "300.000", diffM: "-700.000", diffPct: "-70.00", planBeamCount: 2, receivedBeamCount: 1 },
  yarns: [{
    yarnItemId: "y1", code: "IPL-5X", name: "5X", letter: "A", planNetKg: "50.000", planGrossKg: "51.282", dispatchedKg: "45.000", returnedKg: "0.000", transferInKg: "0.000",
    transferOutKg: "8.000", woundKg: "27.000", fromOwnKg: "23.000", carryOverUsedKg: "4.000", unallocatedKg: "1.500", atSubcontractorKg: "10.000",
  }],
  weighing: { weighedBeamCount: 1, weighedNetKg: "26.500", nominalKg: "27.000", diffKg: "-0.500", diffPct: "-1.85" },
};
const receipt = (over: Partial<WarpingReceipt> = {}): WarpingReceipt => ({
  receiptKey: "rk1", deliveryNoteNo: "DV-118", receivedAt: "2026-11-18T08:00:00Z", beamCount: 1, liveBeamCount: 1, lengthM: "300.000",
  beams: [{ id: "b1", beamNo: "LV1", status: "READY", physicalBeamNo: "G-07", ownerCustomerId: null, lengthM: "300.000", nominalKg: "27.000", grossKg: "56.500", tareKg: "30.000", weighedNetKg: "26.500", weighDiffKg: "-0.500", cancelled: false, yarns: [] }],
  ...over,
});
const preview: WarpingReceivePreview = {
  order: { id: "wo-1", orderNo: "FDV1", status: "IN_PROGRESS" },
  beams: [{ index: 0, lengthM: "500.000", nominalKg: "25.000", weighedNetKg: null, yarns: [{ yarnItemId: "y1", code: "IPL-5X", kg: "25.000" }] }],
  allocations: [{ beamIndex: 0, yarnItemId: "y1", dispatchItemId: "i1", dispatchNo: "FS9", lotNo: "L-501", holderWarpingOrderId: "wo-0", holderOrderNo: "FDV0", carryOver: true, kg: "25.000" }],
  incoming: { beamCount: 1, lengthM: "500.000" }, before: settlement,
  after: { receivedM: "800.000", diffM: "-200.000", yarns: [{ yarnItemId: "y1", woundKg: "52.000", unallocatedKg: "1.500" }] },
  ownerCustomerId: null, warnings: ["IPL-5X: kontrol"],
};
const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

beforeEach(() => {
  setPerms(["warping-order:read", "warping-order:write", "warpbeam:cancel"]);
  Object.values(svc).forEach((f) => f.mockReset());
  svc.receipts.mockResolvedValue({ receipts: [receipt()], settlement });
});

describe("ReceiptsSection", () => {
  it("① mutabakat + kabul satırı; kabul düğmesi durum ve izinle", async () => {
    const { unmount } = renderWithProviders(<ReceiptsSection order={order()} />);
    expect(await screen.findByText(/İrsaliye DV-118/)).toBeTruthy();
    const m = screen.getByLabelText("Metre mutabakatı");
    expect(within(m).getByText("−700 m (−70 %)")).toBeTruthy();
    const y = within(screen.getByLabelText("İplik mutabakatı"));
    for (const t of ["45,000", "27,000", "4,000", "1,500", "10,000", "−8,000"]) expect(y.getAllByText(t).length).toBeGreaterThan(0);
    expect(screen.getByText(/gövde G-07/)).toBeTruthy();
    expect(screen.getByText("56,500 / 30,000")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Levent kabulü/ })).toBeTruthy();
    unmount();
    const r2 = renderWithProviders(<ReceiptsSection order={order("COMPLETED")} />);
    expect(await screen.findByText(/İrsaliye DV-118/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Levent kabulü/ })).toBeNull();
    r2.unmount();
    setPerms(["warping-order:read"]);
    renderWithProviders(<ReceiptsSection order={order()} />);
    expect(await screen.findByText(/İrsaliye DV-118/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Levent kabulü/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Kabulü geri al" })).toBeNull();
  });

  it("② kabul: plandan dolu, önizlemesiz kapalı, değişince kapanır, gövde + token", async () => {
    docSvc.preview.mockResolvedValue({ subcontractorId: "s1", deliveryNoteNo: "DV-9", deliveryNoteUses: [], orders: [{ warpingOrderId: "wo-1", preview }], totals: { orderCount: 1, beamCount: 1, lengthM: "500.000" }, warnings: ["FDV1: IPL-5X: kontrol"] });
    const tokens: string[] = [];
    const errNet = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    docSvc.create.mockImplementation((b: { clientToken: string }) => { tokens.push(b.clientToken); return tokens.length < 2 ? Promise.reject(errNet) : Promise.resolve({ success: true, data: { id: "d1", docNo: "DK-1" } }); });
    const user = userEvent.setup();
    renderWithProviders(<ReceiptsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: /Levent kabulü/ }));
    const dlg = await screen.findByRole("dialog");
    expect((within(dlg).getByLabelText("2. levent metre") as HTMLInputElement).value).toBe("500");
    await user.click(within(dlg).getByRole("button", { name: "2. leventi sil" }));
    await user.type(within(dlg).getByLabelText("Devereci irsaliye no"), "DV-9");
    await user.type(within(dlg).getByLabelText("1. levent brüt kg"), "60");
    await user.type(within(dlg).getByLabelText("1. levent dara kg"), "30");
    const send = () => within(dlg).getByRole("button", { name: /^Kabul et/ }) as HTMLButtonElement;
    expect(send().disabled).toBe(true);
    await user.click(within(dlg).getByRole("button", { name: "Önizle" }));
    expect(await within(dlg).findByText(/devir: FDV0/)).toBeTruthy();
    expect(within(dlg).getByText("IPL-5X: kontrol")).toBeTruthy();
    const body = { subcontractorId: "s1", deliveryNoteNo: "DV-9", orders: [{ warpingOrderId: "wo-1", beams: [{ lengthM: 500, physicalBeamNo: null, grossKg: 60, tareKg: 30 }] }] };
    expect(docSvc.preview).toHaveBeenCalledWith(body);
    expect(send().disabled).toBe(false);
    await user.type(within(dlg).getByLabelText("1. levent gövde no"), "G");
    expect(send().disabled).toBe(true);
    expect(within(dlg).getByText(/yeniden önizleyin/)).toBeTruthy();
    await user.clear(within(dlg).getByLabelText("1. levent gövde no"));
    await user.click(within(dlg).getByRole("button", { name: "Önizle" }));
    await waitFor(() => expect(send().disabled).toBe(false));
    await user.click(send());
    await waitFor(() => expect(tokens.length).toBe(1));
    await user.click(send());
    await waitFor(() => expect(tokens.length).toBe(2));
    expect(tokens[1]).toBe(tokens[0]);
    expect(docSvc.create).toHaveBeenLastCalledWith({ ...body, clientToken: tokens[0] });
  });

  it("③ geri alma: her levent listelenir; engelde sunucu cümlesi, sebep yok, düğme kapalı", async () => {
    svc.cancelPreview.mockResolvedValue({
      receiptKey: "rk1", orderStatus: "IN_PROGRESS", beams: [{ id: "b1", beamNo: "LV1", status: "READY", lengthM: "300.000", cancellable: true, blocker: null }],
      released: [{ dispatchItemId: "i1", dispatchNo: "FS1", yarnItemId: "y1", holderWarpingOrderId: "wo-1", kg: "15.000" }],
      blockers: ["Daha yeni bir kabul var (LV2) — kabuller sondan başa (LIFO) geri alınır."], reasonRequired: true,
    });
    const user = userEvent.setup();
    renderWithProviders(<ReceiptsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "Kabulü geri al" }));
    const dlg = await screen.findByRole("dialog");
    const list = within(await within(dlg).findByLabelText("Etkilenen kayıtlar"));
    expect(list.getByText("LV1")).toBeTruthy();
    expect(list.getByText(/5X \(IPL-5X\) — 15,000 kg FS1/)).toBeTruthy();
    expect(list.queryByText(/İptal olur/)).toBeNull();
    expect(within(dlg).getByText(/LIFO/)).toBeTruthy();
    expect(within(dlg).queryByLabelText(/Geri alma sebebi/)).toBeNull();
    expect((within(dlg).getByRole("button", { name: "Kabulü geri al" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
