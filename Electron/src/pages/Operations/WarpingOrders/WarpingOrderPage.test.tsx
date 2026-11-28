// =============================================================================
// BEKÇİ — fason devere sipariş sayfası: yazma yüzeyi durum + izinle · iptal önizlemesi · deneme token'ı
// =============================================================================
//   ① OPEN siparişte (write+cancel) "Düzenle" ve "İptal et" çizilir; plan tablosu sunucu sayılarını basar.
//   ② Kapalı (COMPLETED) siparişte yazma yüzeyi HİÇ çizilmez; izinsiz kullanıcıda da yok.
//   ③ İptal diyaloğu önizlemedeki etkilenen kayıtları listeler; engelli (sevkli) siparişte düğme kapalı.
//   ④ Yeni sipariş: kesin 4xx'ten sonra ikinci deneme YENİ token, ağ hatasından sonra AYNI token (mantıksal deneme).
//   ⑤ "Levent adedi belli değil": adet/boy gizlenir, yalnız toplam metre; gövde openTargetLengthM taşır. Açık adet
//      sipariş özeti "(adet devereciye bırakıldı)" basar. SONDA 2026-11-19: anahtar koşulu ters çevrildi → ⑤ ❌.
// NEGATİF SONDA (2026-11-18): `OrderActions`ta `editable` kapısı kaldırıldı → ② ❌; iptal sebebi kutusu engelli siparişte de
// çizildi (`p.canCancel` → `p`) → ③ ❌; FormDialog `onError`dan `attempt.onFailure` çıkarıldı → ④ (4xx sonrası yeni token) ❌. Geri alındı.
// =============================================================================
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { WarpingOrder, WarpingOrderCancelPreview } from "./types";

vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "wo-1" }),
}));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions, titleExtra }: { title: string; actions?: ReactNode; titleExtra?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {titleExtra}
      {actions}
    </div>
  ),
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const get = vi.fn();
const cancelPreview = vi.fn();
const create = vi.fn();
vi.mock("./service", async (orig) => {
  const real = await orig<typeof import("./service")>();
  return {
    ...real,
    warpingOrderService: { ...real.warpingOrderService, get: (...a: unknown[]) => get(...a), cancelPreview: (...a: unknown[]) => cancelPreview(...a), create: (...a: unknown[]) => create(...a), cancel: vi.fn() },
    useWarpingPreview: () => ({ data: undefined, isError: false, isFetching: false }),
    useWarpingOrder: (id: string) => useQuery({ queryKey: ["wo-test", id], queryFn: () => get(id) }),
  };
});

vi.mock("./yarn-service", () => ({
  warpingYarnService: {},
  useWarpingDispatches: () => ({ data: [], isSuccess: true, isError: false, refetch: vi.fn() }),
  useWarpingInstruction: () => ({ data: undefined, isLoading: true, isError: false }),
}));
vi.mock("./holding-service", () => {
  const emptyList = () => ({ data: [], isSuccess: true, isError: false });
  return { warpingHoldingService: {}, useWarpingHoldings: emptyList, useWarpingReturns: emptyList, useWarpingTransfers: emptyList };
});
vi.mock("./receive-service", () => ({ warpingReceiveService: {}, useWarpingReceipts: () => ({ data: undefined, isSuccess: false, isError: false }) }));
vi.mock("./settle-service", () => ({ warpingSettleService: {}, useWarpingSettlements: () => ({ data: [], isSuccess: true, isError: false }) }));
vi.mock("./rejection-service", () => ({ warpingRejectionService: {}, useWarpingRejections: () => ({ data: undefined, isSuccess: false, isError: false }) }));
vi.mock("./FeeInvoiceSection", () => ({ FeeInvoiceSection: () => null }));

import { WarpingOrderPage } from "./WarpingOrderPage";
import { WarpingOrderFormDialog } from "./WarpingOrderFormDialog";

function order(status: WarpingOrder["status"] = "OPEN"): WarpingOrder {
  return {
    id: "wo-1", orderNo: "FD-0001", status,
    warpSpec: { id: "ws", code: "CZG-XYZ", name: "Tül çözgü", sequenceNote: "A B C", reedNo: null, reedWidthCm: null, endsPerDent: null },
    subcontractor: { id: "s1", code: "DV", name: "Devereci A" },
    beamLines: [{ beamCount: 2, beamLengthM: "1000.000" }], beamCount: 2, targetLengthM: "2000.000",
    extraSpecs: [], salesOrders: [], fixedWasteM: "0.000", wasteTolerancePct: null,
    fee: { unit: "METRE", unitPrice: null, currency: null }, expectedReturnAt: null, notes: null, hasWaste: false,
    yarns: [{ yarnItemId: "y1", code: "PES-50", name: "PES 50 denye", sourceWarpSpecId: "ws", endsCount: 2000, denier: "50.000", wastePct: "0", netKg: "22.222", grossKg: "22.222", letter: "A" }],
    totals: { endsCount: 2000, netKg: "22.222", grossKg: "22.222" },
    completedAt: null, cancelledAt: null, cancelReason: null, createdAt: "2026-11-18T08:00:00Z", updatedAt: "2026-11-18T08:00:00Z",
  };
}

const allPerms = ["warping-order:read", "warping-order:write", "warping-order:cancel"];
const setPerms = (permissions: string[]) => useAuthStore.getState().setUser({ userId: "u1", username: "plan", permissions });

describe("WarpingOrderPage — yazma yüzeyi", () => {
  beforeEach(() => setPerms(allPerms));

  it("① OPEN siparişte düzenle + iptal; plan sunucu sayısını basar", async () => {
    get.mockResolvedValue(order("OPEN"));
    renderWithProviders(<WarpingOrderPage />);
    expect(await screen.findByText("FD-0001")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Düzenle/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /İptal et/ })).toBeTruthy();
    expect(screen.getAllByText("22,222").length).toBeGreaterThan(0);
    expect(screen.getByText("Açık")).toBeTruthy();
  });

  it("⑥ tek iplik + dizilim notu yok: özet 'A · 2.000 tel (tek iplik)'; gönderilen satırı her zaman var", async () => {
    get.mockResolvedValue({ ...order("OPEN"), warpSpec: { ...order().warpSpec, sequenceNote: null } });
    renderWithProviders(<WarpingOrderPage />);
    expect((await screen.findByTestId("order-warp-report")).textContent).toMatch(/^A · 2\.?000 tel \(tek iplik\)$/);
    expect(screen.getByTestId("order-sent-totals").textContent).toBe("Henüz sevk yok");
  });

  it("② kapalı siparişte ve izinsiz kullanıcıda yazma düğmesi yok", async () => {
    get.mockResolvedValue(order("COMPLETED"));
    const { unmount } = renderWithProviders(<WarpingOrderPage />);
    await screen.findByText("FD-0001");
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /İptal et/ })).toBeNull();
    unmount();
    setPerms(["warping-order:read"]);
    get.mockResolvedValue(order("OPEN"));
    renderWithProviders(<WarpingOrderPage />);
    await screen.findByText("FD-0001");
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
  });

  it("③ iptal diyaloğu etkilenen kayıtları listeler; engelli siparişte düğme kapalı", async () => {
    get.mockResolvedValue(order("IN_PROGRESS"));
    const pv: WarpingOrderCancelPreview = {
      order: { id: "wo-1", orderNo: "FD-0001", status: "IN_PROGRESS", targetLengthM: "2000.000", beamCount: 2 },
      canCancel: false, blockedReason: "Siparişin iplik sevki var — önce sevk(ler)i iptal edin.",
      salesOrders: [{ id: "o1", orderNumber: "S-77", status: "OPEN", customerName: "Müşteri B" }], affected: { dispatches: 1, beams: 0 },
    };
    cancelPreview.mockResolvedValue(pv);
    const user = userEvent.setup();
    renderWithProviders(<WarpingOrderPage />);
    await user.click(await screen.findByRole("button", { name: /İptal et/ }));
    expect(await screen.findByText(/önce sevk\(ler\)i iptal edin/)).toBeTruthy();
    expect(screen.getByText(/S-77/)).toBeTruthy();
    expect(screen.getByText(/İplik sevki: 1/)).toBeTruthy();
    expect(screen.queryByLabelText(/İptal sebebi/)).toBeNull();
    expect((screen.getByRole("button", { name: /Siparişi iptal et/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("WarpingOrderFormDialog — clientToken mantıksal deneme başına", () => {
  beforeEach(() => setPerms(allPerms));

  it("④ kesin 4xx sonrası yeni token; ağ hatası sonrası aynı token", async () => {
    const tokens: string[] = [];
    const err4xx = Object.assign(new Error("400"), { response: { status: 400, data: {} } });
    const errNet = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    create.mockImplementation((_b: unknown, t: string) => {
      tokens.push(t);
      return Promise.reject(tokens.length === 1 ? err4xx : errNet);
    });
    const user = userEvent.setup();
    renderWithProviders(<WarpingOrderFormDialog seed={{ warpSpecId: "ws", subcontractorId: "s1", beamLines: [{ beamCount: "1", beamLengthM: "1000" }] }} onClose={() => {}} onSaved={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Siparişi aç" });
    await user.click(btn);
    await waitFor(() => expect(tokens.length).toBe(1));
    await user.click(await screen.findByRole("button", { name: "Siparişi aç" }));
    await waitFor(() => expect(tokens.length).toBe(2));
    await user.click(await screen.findByRole("button", { name: "Siparişi aç" }));
    await waitFor(() => expect(tokens.length).toBe(3));
    expect(tokens[1]).not.toBe(tokens[0]);
    expect(tokens[2]).toBe(tokens[1]);
  });
});

describe("WarpingOrderFormDialog — geniş form iskeleti", () => {
  it("geniş diyalog; bölüm kartları; ücret · birim ücret · para birimi · termin ayrı alanlar; plan tablosunda iplik ADI birincil", () => {
    renderWithProviders(<WarpingOrderFormDialog order={order("IN_PROGRESS")} onClose={() => {}} onSaved={() => {}} />);
    expect(document.querySelector("[data-form-size='wide']")).toBeTruthy();
    for (const t of ["Sipariş", "Leventler", "Ücret, termin ve fire", "İplik planı"]) expect(screen.getByRole("region", { name: t })).toBeTruthy();
    expect(screen.getByLabelText("Para birimi")).toBeTruthy();
    expect(screen.getByLabelText("Birim ücret")).toBeTruthy();
    const cell = screen.getByText("PES 50 denye");
    expect(cell.className).toContain("font-medium");
    expect(cell.nextElementSibling?.textContent).toBe("PES-50");
    // Uzun açıklamalar satırda değil (i) balonunda.
    expect(screen.queryByText(/Kapanışta aşılırsa uyarır/)).toBeNull();
  });

  it("Not daraltılabilir: boşsa kapalı, doluysa açık gelir", () => {
    const { unmount } = renderWithProviders(<WarpingOrderFormDialog order={order("IN_PROGRESS")} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByTestId("wo-notes-section") as HTMLDetailsElement).open).toBe(false);
    unmount();
    renderWithProviders(<WarpingOrderFormDialog order={{ ...order("IN_PROGRESS"), notes: "Kenarlar sıkı" }} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByTestId("wo-notes-section") as HTMLDetailsElement).open).toBe(true);
  });
});

describe("WarpingOrderFormDialog — levent adedi belli değil", () => {
  beforeEach(() => setPerms(allPerms));

  it("⑤ anahtar açılınca adet/boy gizlenir, toplam metre ile gönderilir", async () => {
    const bodies: unknown[] = [];
    create.mockImplementation((b: unknown) => {
      bodies.push(b);
      return Promise.resolve({ success: true, data: order("OPEN") });
    });
    const user = userEvent.setup();
    renderWithProviders(<WarpingOrderFormDialog seed={{ warpSpecId: "ws", subcontractorId: "s1" }} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText("1. satır levent adedi")).toBeTruthy();
    expect(screen.queryByLabelText("Toplam metre")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Levent adedi belli değil" }));
    expect(screen.queryByLabelText("1. satır levent adedi")).toBeNull();
    await user.type(screen.getByLabelText("Toplam metre"), "1500");
    await user.click(screen.getByRole("button", { name: "Siparişi aç" }));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(bodies[0]).toMatchObject({ openTargetLengthM: 1500 });
    expect(bodies[0]).not.toHaveProperty("beamLines");
  });

  it("⑤ açık adet sipariş özeti: toplam metre + adet devereciye bırakıldı", async () => {
    get.mockResolvedValue({ ...order("OPEN"), beamLines: [], beamCount: null, beamCountOpen: true, targetLengthM: "1500.000" });
    renderWithProviders(<WarpingOrderPage />);
    expect(await screen.findByText(/adet devereciye bırakıldı/)).toBeTruthy();
    expect(screen.queryByText(/null levent/)).toBeNull();
  });
});
