import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { Order } from "../types";
import type { ProductionProposal } from "./types";

const api = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("./service", () => ({ productionProposalService: api }));
const flags = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: flags.value } }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

import { ProductionProposalDialog } from "./ProductionProposalDialog";
import { ProductionProposalButton } from "./ProductionProposalButton";

const proposal: ProductionProposal = {
  orderId: "o1",
  orderNumber: "SIP1",
  weavingOrders: [{ key: "W|i1|-", itemId: "i1", itemName: "Tül A", recipeId: null, warpSpecId: null, weftSpecId: null, weaveDesignId: null, shrinkPct: 10, plannedM: 1111.111, orderLines: [{ orderLineId: "l1", openM: 1000, allocatedM: 1000 }] }],
  workOrders: [{ key: "WO|a", itemId: "i1", itemName: "Tül A", colorId: null, width: 280, routeId: "r", foldType: null, targetQuantity: 1000, orderLines: [{ orderLineId: "l1", allocatedQty: 1000 }], blockedCode: null }],
  excluded: [{ orderLineId: "l2", kind: "LINE", code: "ORDER_LINE_ALREADY_PLANNED" }],
  canCreate: { weaving: true, workOrder: true },
};
const order = { id: "o1", orderNumber: "SIP1", status: "APPROVED", lines: [] } as unknown as Order;

beforeEach(() => {
  api.preview.mockReset().mockResolvedValue(proposal);
  api.apply.mockReset();
  flags.value = { orderProductionProposal: "ONIZLEME", productionEnabled: true, dokumaEnabled: true };
});

describe("Üretime gönder (SY-M3)", () => {
  it("KAPALI'da düğme çizilmez ve önizleme isteği atılmaz", () => {
    flags.value = { orderProductionProposal: "KAPALI", productionEnabled: true, dokumaEnabled: true };
    renderWithProviders(<ProductionProposalButton order={order} />);
    expect(screen.queryByRole("button", { name: /Üretime gönder/ })).toBeNull();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("ONIZLEME'de düğme diyaloğu açar; her kayıt listelenir, dışarıda kalan nedenle yazılır", async () => {
    renderWithProviders(<ProductionProposalButton order={order} />);
    fireEvent.click(screen.getByRole("button", { name: /Üretime gönder/ }));
    expect(await screen.findByText(/Dokuma İş Emirleri \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Terbiye iş emirleri \(1\)/)).toBeTruthy();
    expect(screen.getByText(/zaten planlanmış/)).toBeTruthy();
  });

  it("per-kayıt seçim: işareti kaldırılan gövdeye girmez", async () => {
    api.apply.mockResolvedValue({ success: true, data: { weavingOrders: [{ id: "w1", number: "DK1" }], workOrders: [] } });
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /terbiye iş emrini seç/ }));
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    await screen.findByText(/DK1/);
    const body = api.apply.mock.calls[0]?.[1];
    expect(body.workOrders).toEqual([]);
    expect(body.weavingOrders.map((w: { key: string }) => w.key)).toEqual(["W|i1|-"]);
  });

  it("409 cümlesi diyalogda kalır, Oluştur kapanır; yenileme yeni önizleme ister", async () => {
    api.apply.mockRejectedValue({ response: { status: 409, data: { message: "Seçilen sipariş satırlarından bazıları bu arada planlanmış — önizlemeyi yenileyin.", details: { code: "ORDER_LINE_ALREADY_PLANNED", orderLineIds: ["l1"] } } } });
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    await screen.findByText(/Dokuma İş Emirleri/);
    fireEvent.click(screen.getByRole("button", { name: "Oluştur" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/bu arada planlanmış/);
    expect(screen.getByRole("button", { name: "Oluştur" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Önizlemeyi yenile" }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledTimes(2));
  });

  it("karar özetleri: dolu → üç satır + ayrıntı; fire notu", async () => {
    api.preview.mockResolvedValue({
      ...proposal,
      weavingWastePct: 2,
      deadline: "2026-12-01T00:00:00.000Z",
      weavingOrders: [{
        ...proposal.weavingOrders[0], shrinkSource: "YAPI", weavingWastePct: 2,
        loomSummary: { requiredM: 1111, best: { machineId: "m7", code: "T-07", name: "T7", tier: "BEAM_SHORT", weavableM: 620, readyBeamNo: null, sameDesignRunning: false, hasOpenRun: true, widthWarning: true }, counts: { READY: 0, BEAM_SHORT: 2, WARP_CHANGE: 5 } },
        yarnSummary: { rawM: 1111, yarns: [{ yarnItemId: "y1", code: "IP-150D", name: "Polyester", needKg: 80, shortKg: 34.2 }], totalShortKg: 34.2, sources: { stock: true, openPurchase: true, readyBeams: true } },
        durationEstimate: { machineId: "m7", picksPerCm: 24, planRpm: 420, planEfficiencyPct: 85, weavingHours: 117.4, weavingDays: 4.89, hoursUntilDeadline: 90, weavingOnlyFitsDeadline: false },
      }],
    });
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    const box = await screen.findByTestId("proposal-insights");
    expect(box).toHaveTextContent("T-07 tezgâhında levent yetmez, 620 m dokur");
    expect(box).toHaveTextContent("levent kısa 2 · değişim 5");
    expect(box).toHaveTextContent("Tarak dar");
    expect(box).toHaveTextContent("IP-150D: 34,2 kg eksik");
    expect(box).toHaveTextContent("yalnız dokuma süresi bile termini aşıyor");
    expect(screen.getByText(/%2 dokuma firesi dahil/)).toBeTruthy();
    expect(screen.getByText(/çekme %10 \(ürün yapısından\)/)).toBeTruthy();
    expect(screen.queryByTestId("proposal-insights-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ayrıntı" }));
    const detail = screen.getByTestId("proposal-insights-detail");
    expect(detail).toHaveTextContent("Polyester");
    expect(detail).toHaveTextContent("T-07 · devir 420/dk · verim %85 · atkı sıklığı 24 atkı/cm");
    fireEvent.click(screen.getByRole("button", { name: "ayrıntıyı gizle" }));
    expect(screen.queryByTestId("proposal-insights-detail")).toBeNull();
  });

  it("özetler null ya da hiç yok (eski backend) → satır yok, çökmez; fire 0 yazılmaz", async () => {
    api.preview.mockResolvedValue({ ...proposal, weavingWastePct: 0, weavingOrders: [{ ...proposal.weavingOrders[0], loomSummary: null, yarnSummary: null, durationEstimate: null }] });
    const { unmount } = renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    await screen.findByText(/Dokuma İş Emirleri/);
    expect(screen.queryByTestId("proposal-insights")).toBeNull();
    expect(screen.queryByText(/dokuma firesi/)).toBeNull();
    unmount();
    api.preview.mockResolvedValue(proposal);
    renderWithProviders(<ProductionProposalDialog open onOpenChange={() => {}} orderId="o1" />);
    await screen.findByText(/Dokuma İş Emirleri/);
    expect(screen.queryByTestId("proposal-insights")).toBeNull();
  });
});
