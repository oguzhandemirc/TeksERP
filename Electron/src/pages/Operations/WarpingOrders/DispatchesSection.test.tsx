// =============================================================================
// BEKÇİ — sipariş sayfası Sevkler bölümü + yeni sevk + sevk iptali (D6b)
// =============================================================================
//   ① Liste iptal edilen sevki de gösterir (rozet + sebep); iptalde yazdır/iptal düğmesi yok; yeni sevk yalnız
//      OPEN/IN_PROGRESS + `warping-order:write`.
//   ② Yeni sevk: öneri satıra dolar, tek bakiyeli depo önceden seçilir, lot kuralı notu satırda; gövde sunucuya
//      satırlarla + clientToken gider; kesin 4xx sonrası YENİ token, ağ hatası sonrası AYNI token.
//   ③ Sevk iptali önizlemedeki her kalemi listeler; engelli sevkte sebep kutusu yok, düğme kapalı.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D6b".
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder } from "./types";
import type { WarpingDispatchCancelPreview, WarpingDispatchPreview, WarpingDispatchRow } from "./yarn-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const svc = vi.hoisted(() => ({ dispatches: vi.fn(), dispatchPreview: vi.fn(), dispatch: vi.fn(), dispatchCancelPreview: vi.fn(), cancelDispatch: vi.fn(), instruction: vi.fn() }));
vi.mock("./yarn-service", async (orig) => {
  const real = await orig<typeof import("./yarn-service")>();
  return {
    ...real,
    warpingYarnService: svc,
    useWarpingDispatches: (id: string) => useQuery({ queryKey: ["wd-test", id], queryFn: () => svc.dispatches(id) }),
  };
});
vi.mock("@/pages/Operations/Yarn/service", () => ({
  listYarnStocks: vi.fn(async () => ({ data: [{ warehouse: { id: "w1", code: "DP", name: "Merkez Depo" }, balanceKg: "80" }] })),
  listYarnLots: vi.fn(async () => ({ data: [] })),
}));

import { DispatchesSection } from "./DispatchesSection";

const order = (status: WarpingOrder["status"] = "IN_PROGRESS") => ({ id: "wo-1", orderNo: "FDV1", status, subcontractor: { id: "s1", code: "S", name: "Devereci A" } }) as unknown as WarpingOrder;

const item = (id: string, over = {}) => ({
  dispatchItemId: id, yarnItemId: "y1", yarnItemCode: "IPL-5X", yarnItemName: "5X", warehouseId: "w1", warehouseName: "Merkez Depo", lotId: "L1", lotNo: "L-501",
  ownerCustomerId: null, outKg: "30.000", returnedKg: "0.000", transferOutKg: "0.000", transferInKg: "0.000", allocatedKg: "0.000", holdingKg: "30.000", ...over,
});
function row(no: string, status: WarpingDispatchRow["status"], over: Partial<WarpingDispatchRow> = {}): WarpingDispatchRow {
  return {
    dispatchId: `d-${no}`, dispatchNo: no, dispatchedAt: "2026-11-18T08:00:00Z", status, cancelledAt: status === "CANCELLED" ? "2026-11-18T09:00:00Z" : null,
    cancelReason: status === "CANCELLED" ? "yanlış lot" : null, goodsReceiptId: null, totalOutKg: "30.000", totalReturnedKg: "0.000", totalTransferOutKg: "0.000",
    totalTransferInKg: "0.000", totalAllocatedKg: "0.000", totalHoldingKg: "30.000", canCancel: status === "ACTIVE", cancelBlockedReason: null, items: [item(`i-${no}`)], ...over,
  };
}
const preview: WarpingDispatchPreview = {
  order: { id: "wo-1", orderNo: "FDV1", status: "IN_PROGRESS", subcontractorId: "s1" }, lotPolicy: "WARN", lotRequired: false, ownerCustomerId: null, stock: { known: true },
  yarns: [{
    yarnItemId: "y1", code: "IPL-5X", name: "5X", letter: "A", endsCount: 3000, planNetKg: "50.000", planGrossKg: "51.282", dispatchedKg: "30.000", returnedKg: "0.000",
    transferInKg: "0.000", transferOutKg: "0.000", atSubcontractorKg: "30.000", carryOverKg: "0.000", suggestedKg: "21.282", depoKg: "80.000", shortageKg: "0.000",
    lots: [{ lotId: "L1", lotNo: "L-501", openKg: "30.000" }],
  }],
  warnings: [],
};
const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

describe("DispatchesSection", () => {
  beforeEach(() => {
    setPerms(["warping-order:read", "warping-order:write", "warping-order:cancel"]);
    Object.values(svc).forEach((f) => f.mockReset());
  });

  it("① iptalli sevk görünür, eylemsiz; yeni sevk durum + izinle", async () => {
    svc.dispatches.mockResolvedValue([row("FS1", "ACTIVE"), row("FS2", "CANCELLED")]);
    const { unmount } = renderWithProviders(<DispatchesSection order={order()} />);
    expect(await screen.findByText("FS2")).toBeTruthy();
    expect(screen.getByText(/yanlış lot/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "FS1 sevkini iptal et" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "FS2 sevkini iptal et" })).toBeNull();
    expect(screen.queryByRole("button", { name: /FS2 irsaliye/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Yeni sevk/ })).toBeTruthy();
    unmount();
    const { unmount: u2 } = renderWithProviders(<DispatchesSection order={order("COMPLETED")} />);
    await screen.findByText("FS1");
    expect(screen.queryByRole("button", { name: /Yeni sevk/ })).toBeNull();
    u2();
    setPerms(["warping-order:read"]);
    renderWithProviders(<DispatchesSection order={order()} />);
    await screen.findByText("FS1");
    expect(screen.queryByRole("button", { name: /Yeni sevk/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "FS1 sevkini iptal et" })).toBeNull();
  });

  it("② yeni sevk: öneri + depo ön seçimi + lot notu; token mantıksal deneme başına", async () => {
    svc.dispatches.mockResolvedValue([]);
    svc.dispatchPreview.mockResolvedValue(preview);
    const tokens: string[] = [];
    const bodies: unknown[] = [];
    const err4xx = Object.assign(new Error("400"), { response: { status: 400, data: {} } });
    const errNet = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    svc.dispatch.mockImplementation((_id: string, b: { clientToken: string }) => {
      tokens.push(b.clientToken);
      bodies.push(b);
      return Promise.reject(tokens.length === 1 ? err4xx : errNet);
    });
    const user = userEvent.setup();
    renderWithProviders(<DispatchesSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: /Yeni sevk/ }));
    const dlg = await screen.findByRole("dialog");
    expect(((await within(dlg).findByLabelText("IPL-5X sevk kg")) as HTMLInputElement).value).toBe("21,282");
    await waitFor(() => expect(within(dlg).getByRole("button", { name: "IPL-5X depo seç" }).textContent).toContain("Merkez Depo"));
    const send = within(dlg).getByRole("button", { name: /Sevk et/ });
    // Deverecide tek lot (L-501) → satır o lotla başlar; karışık lot notu yok.
    expect(within(dlg).getByRole("button", { name: "IPL-5X lot seç" }).textContent).toContain("L-501");
    expect(within(dlg).queryByText(/Karışık lot/)).toBeNull();
    await user.click(send);
    await waitFor(() => expect(tokens.length).toBe(1));
    await user.click(within(dlg).getByRole("button", { name: /Sevk et/ }));
    await waitFor(() => expect(tokens.length).toBe(2));
    await user.click(within(dlg).getByRole("button", { name: /Sevk et/ }));
    await waitFor(() => expect(tokens.length).toBe(3));
    expect(tokens[1]).not.toBe(tokens[0]);
    expect(tokens[2]).toBe(tokens[1]);
    expect(bodies[0]).toMatchObject({ lines: [{ yarnItemId: "y1", warehouseId: "w1", lotId: "L1", qtyKg: 21.282 }] });
  });

  it("③ sevk iptali etkilenen kalemleri listeler; engelli sevkte düğme kapalı", async () => {
    svc.dispatches.mockResolvedValue([row("FS1", "ACTIVE", { canCancel: false, cancelBlockedReason: "iade var" })]);
    const pv: WarpingDispatchCancelPreview = {
      dispatch: { id: "d-FS1", dispatchNo: "FS1", cancelledAt: null }, canCancel: false, blockedReason: "Bu sevkten iade alınmış — önce iadeleri iptal edin (LIFO).",
      items: [{ dispatchItemId: "i-FS1", yarnItemId: "y1", lotNo: "L-501", warehouseId: "w1", outKg: "30.000", returnedKg: "5.000" }], orderReturnsToOpen: true,
    };
    svc.dispatchCancelPreview.mockResolvedValue(pv);
    const user = userEvent.setup();
    renderWithProviders(<DispatchesSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "FS1 sevkini iptal et" }));
    const dlg = await screen.findByRole("dialog");
    expect(await within(dlg).findByText(/IPL-5X 5X · lot L-501 — 30,000 kg Merkez Depo geri girer/)).toBeTruthy();
    expect(within(dlg).getByText(/önce iadeleri iptal edin/)).toBeTruthy();
    expect(within(dlg).getByText(/“Açık” durumuna döner/)).toBeTruthy();
    expect(within(dlg).queryByLabelText(/İptal sebebi/)).toBeNull();
    expect((within(dlg).getByRole("button", { name: "Sevki iptal et" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
