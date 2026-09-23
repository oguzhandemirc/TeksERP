// =============================================================================
// BEKÇİ — sayfa isteği ↔ URL eksen durumu (2026-09-18, d9 L4): eksen taşıyan HER yaprak, URL'deki seçimi İSTEĞE yazar
// =============================================================================
//   Tablo = `reportAxisCoverage` beyanındaki yapraklar. Sayfa `?<eksen>=<id>` ile açılır; rapor ucuna giden istek yakalanır
//   (cevap hiç dönmez → sayfa yükleniyor kalır, veri şekli gerekmez); istekte eksen değeri aranır (querystring ya da axios `params`).
//   NEGATİF SONDA: `reportsClient.getReport` eski allowlist'e dönerse reportsClient üstünden giden 8 yaprak ❌ (zincir kendi istemcisiyle).
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, waitFor } from "@testing-library/react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn() } }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({ shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: () => ({ onClick: () => {}, onAuxClick: () => {}, onContextMenu: () => {} }), useTabTarget: () => ({ onClick: () => {} }) }));
import { OrderIntakePage } from "@/pages/Reports/Sales/OrderIntakePage";
import { DemandAnalysisPage } from "@/pages/Reports/Sales/DemandAnalysisPage";
import { OrderLeadTimePage } from "@/pages/Reports/Sales/OrderLeadTimePage";
import { OrderCancellationPage } from "@/pages/Reports/Sales/OrderCancellationPage";
import { ShipmentScorecardPage } from "@/pages/Reports/Sales/ShipmentScorecardPage";
import { ReturnScorecardPage } from "@/pages/Reports/Sales/ReturnScorecardPage";
import { OpenOrderCoveragePage } from "@/pages/Reports/Sales/OpenOrderCoveragePage";
import { CustomerScorecardPage } from "@/pages/Reports/Customer/CustomerScorecardPage";
import { OrderProfilePage } from "@/pages/Reports/Customer/OrderProfilePage";
import { SubcontractScorecardPage } from "@/pages/Reports/Subcontract/SubcontractScorecardPage";
import { ProductionChainPage } from "@/pages/Reports/Dokuma/ProductionChainPage";

/** reportAxisCoverage `AXES_BY_REPORT` aynası: yaprak · bileşen · denenecek eksen (o yaprağın beyan ettiği ilk eksen). */
const YAPRAKLAR: Array<{ key: string; page: ReactElement; eksen: string; deger: string }> = [
  { key: "sales/order-intake", page: <OrderIntakePage />, eksen: "customerId", deger: "c1" },
  { key: "sales/demand-analysis", page: <DemandAnalysisPage />, eksen: "customerId", deger: "c1" },
  { key: "sales/order-leadtime", page: <OrderLeadTimePage />, eksen: "customerId", deger: "c1" },
  { key: "sales/order-cancellation", page: <OrderCancellationPage />, eksen: "customerId", deger: "c1" },
  { key: "sales/shipment-scorecard", page: <ShipmentScorecardPage />, eksen: "destination", deger: "EXPORT" },
  { key: "sales/return-scorecard", page: <ReturnScorecardPage />, eksen: "destination", deger: "EXPORT" },
  { key: "sales/open-order-coverage", page: <OpenOrderCoveragePage />, eksen: "itemId", deger: "i1" },
  { key: "customer/scorecard", page: <CustomerScorecardPage />, eksen: "customerId", deger: "c1" },
  { key: "customer/order-profile", page: <OrderProfilePage />, eksen: "customerId", deger: "c1" },
  { key: "subcontract/scorecard", page: <SubcontractScorecardPage />, eksen: "subcontractorId", deger: "f1" },
  { key: "dokuma/zincir", page: <ProductionChainPage />, eksen: "customerId", deger: "c1" },
];

function renderAt(ui: ReactElement, url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>);
}

/** Rapor ucuna giden çağrıda eksen değeri var mı — querystring'de ya da axios `params` nesnesinde. */
function requestCarries(key: string, eksen: string, deger: string): boolean {
  return get.mock.calls.some(([url, cfg]) => {
    const u = String(url);
    if (!u.includes(`/api/reports/${key}`)) return false;
    const qs = new URLSearchParams(u.split("?")[1] ?? "");
    const p = (cfg as { params?: Record<string, string> } | undefined)?.params ?? {};
    return qs.get(eksen) === deger || p[eksen] === deger;
  });
}

beforeEach(() => { get.mockReset().mockImplementation(() => new Promise(() => {})); });

describe("eksen taşıyan yapraklar — URL seçimi isteğe iner", () => {
  it.each(YAPRAKLAR)("⭐ $key: ?$eksen=$deger → rapor isteğinde $eksen", async ({ key, page, eksen, deger }) => {
    renderAt(page, `/reports/${key}?${eksen}=${deger}`);
    await waitFor(() => expect(get.mock.calls.some(([u]) => String(u).includes(`/api/reports/${key}`))).toBe(true));
    expect(requestCarries(key, eksen, deger), get.mock.calls.map(([u, c]) => `${String(u)} ${JSON.stringify((c as { params?: unknown })?.params ?? "")}`).join("\n")).toBe(true);
  });
});
