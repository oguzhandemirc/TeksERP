// =============================================================================
// BEKÇİ — sipariş sayfası "Kapanış" + kapanış diyaloğu + yeniden açma (D7b)
// =============================================================================
//   ① Geçmiş satırları (kapanış, yeniden açıldı rozeti, tolerans, fire kalemi); Kapat yalnız IN_PROGRESS, Yeniden aç yalnız
//      COMPLETED, ikisi de `warping-order:settle`.
//   ② Kapanış: satırlar sunucu varsayılanıyla dolu ve önizleme tazedir; girdi değişince Kapat kapanır; iade satırında sebep
//      çipi çıkar; gövde kalem başına iade/fire; tolerans aşımı gerekçe istemez; token mantıksal deneme başına.
//   ③ Yeniden açma önizlemedeki her fire/iadeyi listeler; engelde sunucu cümlesi, sebep kutusu yok, düğme kapalı.
// NEGATİF SONDA: bkz. arşiv notu "Fason devere D7b".
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder } from "./types";
import type { WarpingSettlePreview, WarpingSettlementRecord } from "./settle-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const svc = vi.hoisted(() => ({ defaultPreview: vi.fn(), preview: vi.fn(), settle: vi.fn(), settlements: vi.fn(), reopenPreview: vi.fn(), reopen: vi.fn() }));
vi.mock("./settle-service", () => ({
  warpingSettleService: svc,
  useWarpingSettlements: (id: string) => useQuery({ queryKey: ["ws-test", id], queryFn: () => svc.settlements(id) }),
}));
vi.mock("./yarn-service", () => ({
  useWarpingDispatches: () => ({ data: [{ dispatchNo: "FS1", items: [{ dispatchItemId: "i1", yarnItemCode: "IPL-5X", lotNo: "L-501", warehouseName: "Merkez Depo" }] }] }),
}));
vi.mock("@/pages/ReasonPresets/service", () => ({ reasonPresetService: { list: vi.fn(async () => [{ kind: "YARN_SUBCONTRACT_RETURN", code: "KALAN", label: "Kalan iplik", isActive: true }]) } }));
vi.mock("@/hooks/useWarehouses", () => ({ useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [], isLoading: false }) }));

import { SettlementsSection } from "./SettlementsSection";

const order = (status: WarpingOrder["status"] = "IN_PROGRESS") => ({
  id: "wo-1", orderNo: "FDV1", status, subcontractor: { id: "s1", code: "S", name: "Devereci A" }, yarns: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X" }],
}) as unknown as WarpingOrder;

const record = (over: Partial<WarpingSettlementRecord> = {}): WarpingSettlementRecord => ({
  id: "s1", warpingOrderId: "wo-1", kind: "SETTLE", reason: "fazla kopuş", wastePct: "4.88", tolerancePct: "3.00", overTolerance: true,
  createdAt: "2026-11-18T10:00:00Z", createdById: null, reopened: { id: "r1", createdAt: "2026-11-18T11:00:00Z", reason: "yanlış" }, reversesId: null,
  totalWasteKg: "1.282", totalReturnKg: "0.000", backTransferIds: [], returns: [],
  wastes: [{ id: "w1", kind: "WASTE", dispatchItemId: "i1", dispatchNo: "FS1", yarnItemId: "y1", code: "IPL-5X", name: "5X", lotNo: "L-501", qtyKg: "1.282", overTolerance: true, reversesId: null }],
  ...over,
});

const pv = (over: Partial<WarpingSettlePreview["plan"]> = {}): WarpingSettlePreview => ({
  order: { id: "wo-1", orderNo: "FDV1", status: "IN_PROGRESS" }, canSettle: true, blockers: [], warnings: ["IPL-5X: fire toleransı aşıyor"],
  settlement: {} as WarpingSettlePreview["settlement"],
  plan: {
    isDefault: true, wastePct: "4.88", tolerancePct: "3.00", overTolerance: true,
    lines: [{ dispatchItemId: "i1", dispatchId: "d1", dispatchNo: "FS1", yarnItemId: "y1", lotId: "L1", lotNo: "L-501", own: true, holdingKg: "5.000", returnKg: "0.000", wasteKg: "1.282", keepKg: "3.718" }],
    yarns: [{ yarnItemId: "y1", code: "IPL-5X", plannedWasteKg: "1.282", woundKg: "25.000", holdingKg: "5.000", returnKg: "0.000", wasteKg: "1.282", keepKg: "3.718", wastePct: "4.88", overTolerance: true }],
    ...over,
  },
});

const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

beforeEach(() => {
  setPerms(["warping-order:read", "warping-order:settle"]);
  Object.values(svc).forEach((f) => f.mockReset());
  svc.settlements.mockResolvedValue([record()]);
});

describe("SettlementsSection", () => {
  it("① geçmiş + düğmeler durum ve izinle", async () => {
    const r1 = renderWithProviders(<SettlementsSection order={order()} />);
    expect(await screen.findByText(/Yeniden açıldı/)).toBeTruthy();
    expect(screen.getByText("Toleransı aşan iplik: 5X")).toBeTruthy();
    expect(screen.getByText(/Gerekçe: fazla kopuş/)).toBeTruthy();
    expect(screen.getByText((_, el) => el?.tagName === "TD" && /^Fire · 5X IPL-5X · FS1 · lot L-501$/.test(el.textContent ?? ""))).toBeTruthy();
    expect(screen.getByRole("button", { name: /Siparişi kapat/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Yeniden aç/ })).toBeNull();
    r1.unmount();
    const r2 = renderWithProviders(<SettlementsSection order={order("COMPLETED")} />);
    expect(await screen.findByRole("button", { name: /Yeniden aç/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Siparişi kapat/ })).toBeNull();
    r2.unmount();
    setPerms(["warping-order:read"]);
    renderWithProviders(<SettlementsSection order={order()} />);
    expect(await screen.findByText(/Yeniden açıldı/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Siparişi kapat/ })).toBeNull();
  });

  it("② kapanış: varsayılan taze, değişince kapanır, iade sebebi, gövde, gerekçesiz kapanır, token", async () => {
    svc.defaultPreview.mockResolvedValue(pv());
    svc.preview.mockResolvedValue(pv({ isDefault: false }));
    const tokens: string[] = [];
    const errNet = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    svc.settle.mockImplementation((_id: string, b: { clientToken: string }) => { tokens.push(b.clientToken); return tokens.length < 2 ? Promise.reject(errNet) : Promise.resolve({ success: true, data: {} }); });
    const user = userEvent.setup();
    renderWithProviders(<SettlementsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: /Siparişi kapat/ }));
    const dlg = await screen.findByRole("dialog");
    const fire = (await within(dlg).findByLabelText("IPL-5X FS1 fire kg")) as HTMLInputElement;
    expect(fire.value).toBe("1,282");
    expect(within(dlg).getByText(/IPL-5X: fire toleransı aşıyor/)).toBeTruthy();
    expect(within(dlg).getByText(/gerekçe yazmanız önerilir/)).toBeTruthy();
    const close = () => within(dlg).getByRole("button", { name: "Siparişi kapat" }) as HTMLButtonElement;
    expect(close().disabled).toBe(false);
    await user.type(within(dlg).getByLabelText("IPL-5X FS1 iade kg"), "2");
    expect(close().disabled).toBe(true);
    expect(within(dlg).getByText(/yeniden önizleyin/)).toBeTruthy();
    expect((within(dlg).getByRole("button", { name: "Önizle" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dlg).getByRole("combobox", { name: "İade sebebi" }));
    await user.click(await screen.findByRole("option", { name: "Kalan iplik" }));
    expect((within(dlg).getByRole("button", { name: "Önizle" }) as HTMLButtonElement).disabled).toBe(false);
    expect(close().disabled).toBe(true);
    await user.click(within(dlg).getByRole("button", { name: "Önizle" }));
    const body = { reason: null, returnReasonCode: "KALAN", lines: [{ dispatchItemId: "i1", returnKg: 2, wasteKg: 1.282 }] };
    await waitFor(() => expect(svc.preview).toHaveBeenCalledWith("wo-1", body));
    await waitFor(() => expect(close().disabled).toBe(false));
    await user.click(close());
    await waitFor(() => expect(tokens.length).toBe(1));
    await user.click(close());
    await waitFor(() => expect(tokens.length).toBe(2));
    expect(tokens[1]).toBe(tokens[0]);
    expect(svc.settle).toHaveBeenLastCalledWith("wo-1", { ...body, clientToken: tokens[0] });
  });

  it("③ yeniden açma: her kayıt listelenir; engelde sebep yok, düğme kapalı", async () => {
    svc.reopenPreview.mockResolvedValue({
      order: { id: "wo-1", orderNo: "FDV1", status: "COMPLETED" }, canReopen: false, blockers: ["Daha yeni bir kabul var — önce onu geri alın."], settlement: record({ reopened: null }),
      wastesToCancel: [{ wasteId: "w1", dispatchItemId: "i1", qtyKg: "1.282" }], returnsToCancel: [{ movementId: "m1", dispatchItemId: "i1", qtyKg: "2.000" }], transfersToCancel: [],
    });
    const user = userEvent.setup();
    renderWithProviders(<SettlementsSection order={order("COMPLETED")} />);
    await user.click(await screen.findByRole("button", { name: /Yeniden aç/ }));
    const dlg = await screen.findByRole("dialog");
    const list = within(await within(dlg).findByLabelText("Etkilenen kayıtlar"));
    expect(list.getByText(/Fire geri alınır: IPL-5X · FS1 · lot L-501 — 1,282 kg/)).toBeTruthy();
    expect(list.getByText(/İade geri alınır: IPL-5X · FS1 · lot L-501 — 2,000 kg/)).toBeTruthy();
    expect(within(dlg).getByText(/Daha yeni bir kabul var/)).toBeTruthy();
    expect(within(dlg).queryByLabelText(/Yeniden açma sebebi/)).toBeNull();
    expect((within(dlg).getByRole("button", { name: "Yeniden aç" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
