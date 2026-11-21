// =============================================================================
// BEKÇİ — kusurlu sarım reddi paneli (devere ek C2)
// =============================================================================
//   ① Dönen sarım satırında "Geri gönder" yalnız HAZIR + sipariş açık + `warping-order:write`; reddedilende "Reddedildi · DR-…"
//      rozeti; yeniden sarımda reddedilenin no'su; kabul diyaloğunda aday varsa "Yeniden sarım" sütunu.
//   ② Ret: sebepsiz önizleme kapalı; önizleme dönecek ipliği gösterir; girdi değişince "Gönder" kapanır; gönderim
//      gövdesi + token; başarıda belge açılır ve baskı bir kez kendiliğinden tetiklenir.
//   ③ Sunucu engeli (foto zorunlu) → "Gönder" kapalı, sunucu cümlesi görünür.
//   ④ Ret iptali: önizlemede engel varsa sebep kutusu yok, düğme kapalı.
// NEGATİF SONDA (2026-11-21): `BeamRow`dan `b.status === "READY"` kapısı çıkarıldı → ① ❌ (reddedilene de düğme). Geri alındı.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQuery } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder } from "./types";
import type { WarpingReceipt, WarpingSettlement } from "./receive-types";
import type { WarpingBeamRejection, WarpingBeamRejectionPreview } from "./rejection-types";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const printTracked = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/lib/print", () => ({ printTracked }));
const flags = vi.hoisted(() => ({ devereRejectPhotoRequired: false }));
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({ ...(await orig<typeof import("@/hooks/usePricingEnabled")>()), useFeatureFlags: () => ({ data: { data: flags }, isLoading: false }) }));
vi.mock("@/pages/ReasonPresets/service", () => ({
  reasonPresetService: {
    list: () => Promise.resolve([
      { id: "r1", kind: "WARP_BEAM_REJECT", code: "TEL_KOPUK", label: "Tel kopuk", fullText: null, requiresText: false, sortOrder: 1, isActive: true, isSystem: true },
      { id: "r2", kind: "WARP_BEAM_REJECT", code: "DIGER", label: "Diğer", fullText: null, requiresText: true, sortOrder: 9, isActive: true, isSystem: true },
      { id: "r3", kind: "WARP_RETURN", code: "X", label: "Başka tür", fullText: null, requiresText: false, sortOrder: 1, isActive: true, isSystem: true },
    ]),
  },
}));

const svc = vi.hoisted(() => ({ receipts: vi.fn(), receivePreview: vi.fn(), receive: vi.fn(), cancelPreview: vi.fn(), cancel: vi.fn() }));
vi.mock("./receive-service", () => ({
  warpingReceiveService: svc,
  useWarpingReceipts: (id: string) => useQuery({ queryKey: ["wr-test", id], queryFn: () => svc.receipts(id) }),
}));
const rj = vi.hoisted(() => ({ listForOrder: vi.fn(), preview: vi.fn(), create: vi.fn(), get: vi.fn(), photoBlob: vi.fn(), cancelPreview: vi.fn(), cancel: vi.fn() }));
vi.mock("./rejection-service", () => ({
  warpingRejectionService: rj,
  useWarpingRejections: (id: string) => useQuery({ queryKey: ["rj-test", id], queryFn: () => rj.listForOrder(id) }),
}));

import { ReceiptsSection } from "./ReceiptsSection";
import { BeamRejectionDocDialog } from "./BeamRejectionDocDialog";

const order = (status: WarpingOrder["status"] = "IN_PROGRESS") => ({
  id: "wo-1", orderNo: "FDV1", status, subcontractor: { id: "s1", code: "S", name: "Devereci A" },
  beamLines: [{ beamCount: 1, beamLengthM: "500.000" }], yarns: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X" }],
}) as unknown as WarpingOrder;
const settlement: WarpingSettlement = { metre: { targetM: "1000.000", receivedM: "1000.000", diffM: "0.000", diffPct: "0.00", planBeamCount: 2, receivedBeamCount: 2 }, yarns: [], weighing: null };
const b = (id: string, beamNo: string, status: string, reworkOfBeamId: string | null = null) => ({
  id, beamNo, status, physicalBeamNo: null, ownerCustomerId: null, lengthM: "500.000", nominalKg: "20.000", grossKg: null, tareKg: null, weighedNetKg: null, weighDiffKg: null, cancelled: false, reworkOfBeamId, yarns: [],
});
const receipt: WarpingReceipt = { receiptKey: "rk1", deliveryNoteNo: "DV-1", receivedAt: "2026-11-20T08:00:00Z", beamCount: 3, liveBeamCount: 3, lengthM: "1500.000", beams: [b("b1", "LV1", "READY"), b("b2", "LV2", "REJECTED"), b("b3", "LV3", "READY", "b9")] };
const doc = (over: Partial<WarpingBeamRejection> = {}): WarpingBeamRejection => ({
  id: "d1", docNo: "DR-2611-0001", status: "ACTIVE", mode: "REWORK", order: { id: "wo-1", orderNo: "FDV1", warpSpec: { code: "C1", name: "Kart" } },
  subcontractor: { id: "s1", code: "S", name: "Devereci A" }, reason: { code: "TEL_KOPUK", text: "Tel kopuk" }, notes: null, rejectedAt: "2026-11-20T09:00:00Z", createdAt: "2026-11-20T09:00:00Z",
  cancelledAt: null, cancelReason: null, totals: { beamCount: 1, lengthM: "500.000", nominalKg: "20.000" },
  items: [{ beamId: "b2", beamNo: "LV2", status: "REJECTED", bodyNo: null, lengthM: "500.000", nominalKg: "20.000", endsCount: 400, deliveryNoteNo: "DV-1", receivedAt: null, reversed: false, rework: null },
    { beamId: "b9", beamNo: "LV9", status: "REJECTED", bodyNo: null, lengthM: "500.000", nominalKg: "20.000", endsCount: 400, deliveryNoteNo: "DV-0", receivedAt: null, reversed: false, rework: { id: "b3", beamNo: "LV3" } }],
  photos: [], ...over,
});
const preview = (over: Partial<WarpingBeamRejectionPreview> = {}): WarpingBeamRejectionPreview => ({
  order: { id: "wo-1", orderNo: "FDV1", status: "IN_PROGRESS", subcontractor: { id: "s1", code: "S", name: "Devereci A" } },
  beams: [{ id: "b1", beamNo: "LV1", status: "READY", lengthM: "500.000", nominalKg: "20.000", bodyNo: null, receiptKey: "rk1", deliveryNoteNo: "DV-1", receivedAt: null, invoiceDocNo: null, blocker: null }],
  returnedYarn: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X", dispatchItemId: "i1", dispatchNo: "FS1", lotNo: null, holderWarpingOrderId: "wo-1", holderOrderNo: "FDV1", kg: "20.000" }],
  totals: { beamCount: 1, lengthM: "500.000", nominalKg: "20.000", returnedKg: "20.000" }, reason: { code: "TEL_KOPUK", text: "Tel kopuk" },
  photoRequired: false, blockers: [], warnings: [], rejectable: true, ...over,
});
const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

beforeEach(() => {
  setPerms(["warping-order:read", "warping-order:write", "warping-order:cancel"]);
  [...Object.values(svc), ...Object.values(rj)].forEach((f) => f.mockReset());
  printTracked.mockClear();
  flags.devereRejectPhotoRequired = false;
  svc.receipts.mockResolvedValue({ receipts: [receipt], settlement });
  rj.listForOrder.mockResolvedValue({ success: true, data: [doc()], nextCursor: null, summary: { count: 1, beamCount: 2 } });
});

describe("Kusurlu sarım reddi", () => {
  it("① düğme durum + izinle; Reddedildi rozeti; yeniden sarım bağı", async () => {
    const r1 = renderWithProviders(<ReceiptsSection order={order()} />);
    expect(await screen.findByText("Reddedildi · DR-2611-0001")).toBeTruthy();
    expect(screen.getByText("yeniden sarım ← LV9")).toBeTruthy();
    expect(screen.getByRole("button", { name: "LV1 devereciye geri gönder" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "LV2 devereciye geri gönder" })).toBeNull();
    r1.unmount();
    const r2 = renderWithProviders(<ReceiptsSection order={order("COMPLETED")} />);
    expect(await screen.findByText("Reddedildi · DR-2611-0001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /devereciye geri gönder/ })).toBeNull();
    r2.unmount();
    setPerms(["warping-order:read"]);
    renderWithProviders(<ReceiptsSection order={order()} />);
    expect(await screen.findByText("Reddedildi · DR-2611-0001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /devereciye geri gönder/ })).toBeNull();
  });

  it("① kabul diyaloğu: etkin REWORK adayı varsa yeniden sarım sütunu çizilir", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptsSection order={order()} />);
    await screen.findByText("Reddedildi · DR-2611-0001");
    await user.click(screen.getByRole("button", { name: /Levent kabulü/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByLabelText("1. levent yeniden sarım")).toBeTruthy();
  });

  it("② ret: önizle → dönecek iplik → gönder gövdesi + token → belge + tek otomatik baskı", async () => {
    rj.preview.mockResolvedValue(preview());
    rj.create.mockResolvedValue({ success: true, data: doc({ id: "d2", docNo: "DR-2611-0002" }) });
    rj.get.mockResolvedValue(doc({ id: "d2", docNo: "DR-2611-0002" }));
    const user = userEvent.setup();
    renderWithProviders(<ReceiptsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "LV1 devereciye geri gönder" }));
    const dlg = await screen.findByRole("dialog");
    const btn = (n: string | RegExp) => within(dlg).getByRole("button", { name: n }) as HTMLButtonElement;
    expect(btn("Önizle").disabled).toBe(true);
    await user.click(await within(dlg).findByRole("radio", { name: "Diğer" }));
    expect(within(dlg).getByText(/açıklama zorunlu/)).toBeTruthy();
    expect(within(dlg).queryByRole("radio", { name: "Başka tür" })).toBeNull();
    await user.click(within(dlg).getByRole("radio", { name: "Tel kopuk" }));
    expect(btn("Gönder ve belge bas").disabled).toBe(true);
    await user.click(btn("Önizle"));
    expect(await within(dlg).findByText(/tutan FDV1/)).toBeTruthy();
    expect(rj.preview).toHaveBeenCalledWith(expect.objectContaining({ warpingOrderId: "wo-1", beamIds: ["b1"], reasonCode: "TEL_KOPUK", expectRework: true, photoCount: 0 }));
    expect(btn("Gönder ve belge bas").disabled).toBe(false);
    await user.click(within(dlg).getByRole("radio", { name: /İptal, iplik deverecide/ }));
    expect(btn("Gönder ve belge bas").disabled).toBe(true);
    await user.click(btn("Önizle"));
    await waitFor(() => expect(btn("Gönder ve belge bas").disabled).toBe(false));
    await user.click(btn("Gönder ve belge bas"));
    await waitFor(() => expect(rj.create).toHaveBeenCalledTimes(1));
    expect(rj.create).toHaveBeenCalledWith(expect.objectContaining({ beamIds: ["b1"], expectRework: false, photos: [], clientToken: expect.any(String) }));
    expect(await screen.findByTitle("Ret belgesi önizleme")).toBeTruthy();
    await waitFor(() => expect(printTracked).toHaveBeenCalledTimes(1));
    expect(printTracked).toHaveBeenCalledWith(expect.objectContaining({ subject: { kind: "BELGE", no: "DR-2611-0002", itemCount: 2 } }));
  });

  it("③ sunucu engeli: foto zorunlu → gönder kapalı, cümle görünür", async () => {
    flags.devereRejectPhotoRequired = true;
    rj.preview.mockResolvedValue(preview({ photoRequired: true, rejectable: false, blockers: [{ code: "WARPING_REJECT_PHOTO_REQUIRED", message: "Bu kurulumda ret fotoğrafı zorunlu — en az bir fotoğraf ekleyin." }] }));
    const user = userEvent.setup();
    renderWithProviders(<ReceiptsSection order={order()} />);
    await user.click(await screen.findByRole("button", { name: "LV1 devereciye geri gönder" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText(/en az bir fotoğraf zorunlu/)).toBeTruthy();
    await user.click(await within(dlg).findByRole("radio", { name: "Tel kopuk" }));
    await user.click(within(dlg).getByRole("button", { name: "Önizle" }));
    expect(await within(dlg).findByText(/ret fotoğrafı zorunlu/)).toBeTruthy();
    expect((within(dlg).getByRole("button", { name: "Gönder ve belge bas" }) as HTMLButtonElement).disabled).toBe(true);
  });

});

describe("Ret belgesi iptali", () => {
  it("④ ret iptali: engelde sebep kutusu yok, düğme kapalı", async () => {
    rj.get.mockResolvedValue(doc());
    rj.cancelPreview.mockResolvedValue({
      doc: doc(), cancellable: false, reasonRequired: true,
      blockers: [{ code: "WARPING_REWORK_ACTIVE", message: "LV9 için yeniden sarım kabul edilmiş (LV3) — önce o kabulü geri alın." }],
      items: [{ beamId: "b2", beamNo: "LV2", status: "REJECTED", blocker: null }, { beamId: "b9", beamNo: "LV9", status: "REJECTED", blocker: "yeniden sarım var" }],
      yarn: [{ yarnItemId: "y1", code: "IPL-5X", name: "5X", dispatchItemId: "i1", dispatchNo: "FS1", lotNo: null, holderWarpingOrderId: "wo-1", holderOrderNo: "FDV1", kg: "20.000", holdingKg: "50.000", enough: true }],
    });
    const user = userEvent.setup();
    renderWithProviders(<BeamRejectionDocDialog docId="d1" initial={doc()} onClose={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: /Reddi iptal et/ }));
    const dlg = await screen.findByRole("dialog");
    const list = within(await within(dlg).findByLabelText("Etkilenen sarımlar"));
    expect(list.getByText("LV2")).toBeTruthy();
    expect(list.getByText(/yeniden sarım var/)).toBeTruthy();
    expect(within(dlg).getByText(/önce o kabulü geri alın/)).toBeTruthy();
    expect(within(dlg).queryByLabelText(/İptal sebebi/)).toBeNull();
    expect((within(dlg).getByRole("button", { name: "Reddi iptal et" }) as HTMLButtonElement).disabled).toBe(true);
    expect(printTracked).not.toHaveBeenCalled();
  });
});
