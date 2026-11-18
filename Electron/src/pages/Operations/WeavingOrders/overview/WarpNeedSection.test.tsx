// D8 BEKÇİ — dokuma işi panelinde "Çözgü ihtiyacı": devere kapalı / izin yok / kapalı iş → sorgu ATILMAZ;
// 403 (MODULE_DISABLED) → bölüm çizilmez; öneri satırı "Devere siparişi aç" ile formu dolu açar (yalnız yazma izniyle).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { renderWithProviders } from "@/test/render";
import type { WarpNeedResult } from "@/pages/Operations/WarpPlan/need/need-types";

let devere = true;
vi.mock("@/hooks/usePricingEnabled", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePricingEnabled")>()),
  useDevereEnabled: () => devere,
}));
let perms: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
const openTarget = vi.fn();
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useOpenTarget: () => openTarget }));
const get = vi.fn();
vi.mock("@/services/apiClient", async (orig) => ({
  ...(await orig<typeof import("@/services/apiClient")>()),
  default: { get: (...a: unknown[]) => get(...a) },
}));

import { WarpNeedSection } from "./WarpNeedSection";

const result: WarpNeedResult = {
  source: "WEAVING_ORDER",
  sourceLabel: "DK-0001 · Tül A",
  salesOrder: { id: "o1", label: "S-77" },
  warnings: [],
  rows: [{
    demandKey: "WO:w1", itemId: "i1", itemName: "Tül A", role: "GROUND", beamMode: "GROUND",
    warpSpecId: "ws1", warpSpecCode: "CZ-1", warpSpecName: "Zemin", takeUpPct: 10, ownBeam: true,
    fabricM: 1000, requiredM: 1111.111, supply: { stockM: 200, plannedBeamM: 0, openWarpingM: 300, totalM: 500 },
    committedM: 0, freeM: 500, shortfallM: 611.111, suggestion: { beamCount: 2, beamLengthM: 400, totalM: 800 },
    subcontractor: { id: "s1", name: "Devereci A" }, openWarpingOrders: [],
  }],
};

const forbidden = () =>
  new AxiosError("403", "ERR", undefined, undefined, {
    status: 403, statusText: "Forbidden", headers: {}, config: { headers: new AxiosHeaders() },
    data: { success: false, message: "Devere kapalı", details: { code: "MODULE_DISABLED" } },
  });

beforeEach(() => {
  devere = true;
  perms = ["warpspec:read", "warping-order:write"];
  get.mockReset();
  openTarget.mockReset();
});

const render = (isOpen = true, onNavigate = vi.fn()) =>
  renderWithProviders(<WarpNeedSection weavingOrderId="w1" isOpen={isOpen} onNavigate={onNavigate} />);

describe("WarpNeedSection", () => {
  it("⭐ devere kapalı → sorgu atılmaz, bölüm çizilmez", () => {
    devere = false;
    const { container } = render();
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it("warpspec:read yok ya da iş kapalı → sorgu atılmaz", () => {
    perms = [];
    render();
    render(false);
    expect(get).not.toHaveBeenCalled();
  });

  it("⭐ 403 MODULE_DISABLED → bölüm gizlenir (hata kutusu yok)", async () => {
    get.mockRejectedValue(forbidden());
    const { container } = render();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("öneri satırı → 'Devere siparişi aç' formu kart + adet × boy + devereci + sipariş ile açar, paneli kapatır", async () => {
    get.mockResolvedValue({ data: { success: true, data: result } });
    const onNavigate = vi.fn();
    render(true, onNavigate);
    expect(await screen.findByText("2 × 400 m levent devere ver")).toBeInTheDocument();
    expect(get.mock.calls[0]?.[0]).toBe("/api/warp-plan/need?source=WEAVING_ORDER&weavingOrderId=w1");
    fireEvent.click(screen.getByRole("button", { name: /Devere siparişi aç/ }));
    expect(onNavigate).toHaveBeenCalled();
    expect(openTarget.mock.calls[0]?.[0]).toBe(
      "/operations/fason-devere?new=1&warpSpecId=ws1&beamCount=2&beamLengthM=400&subcontractorId=s1&salesOrderId=o1&salesOrderLabel=S-77",
    );
  });

  it("warping-order:write yok → öneri metni var, düğme yok", async () => {
    perms = ["warpspec:read"];
    get.mockResolvedValue({ data: { success: true, data: result } });
    render();
    expect(await screen.findByText("2 × 400 m levent devere ver")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Devere siparişi aç/ })).toBeNull();
  });
});
