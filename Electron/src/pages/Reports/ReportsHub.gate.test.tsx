// =============================================================================
// RAPOR KAPISI — KARO · ŞERİT · PALET (Raporlar K5, üç yolun birinci ve üçüncüsü)
// =============================================================================
// Üç yüzey aynı yüklemi okur (`isReportOpen` / `categoryHasOpenReport`): kapalı rapor alt
// karoda, sağ şeritte ve komut paletinde yoktur; bütün raporları kapalı kategori üst karoda
// ve palet başlığında yoktur. Yüklem ctx'te; bu test ctx'i sahteler ve yüzeylerin ona
// UYDUĞUNU ölçer (ctx'in kendisi `report-gate.test.ts` + `ProtectedRoute.report.test.tsx`).
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `ReportHubGrid`ten süzme
// kaldırıldı → §1 ❌; `ReportsHubPage`ten `categoryHasOpenReport` kaldırıldı → §2 ❌;
// palet alt girişinin `visibleWhen`i eski hâline (yalnız modül) döndürüldü → §4 ❌.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { isReportOpenWith } from "@/lib/report-gate";

let closed: string[] | null = [];
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false,
  depoMultiEnabled: false,
  devereEnabled: false,
  dokumaEnabled: true,
  financeEnabled: true,
  productionEnabled: true,
  ticaretEnabled: true,
  iplikEnabled: true,
  reportsClosedKeys: closed,
  isReportOpen: (key: string) => isReportOpenWith(closed, key),
  flagsReady: true,
  flagsFailed: false,
});
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx() }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));

import { ReportHubGrid } from "./_components/ReportHubGrid";
import { ReportsHubPage } from "./ReportsHubPage";
import { salesReportTiles } from "./Sales/tile-config";
import { reportCommandSections } from "@/components/layout/command-entries.reports";

const SALES_KEYS = REPORT_CATALOG.filter((r) => r.key.startsWith("sales/")).map((r) => r.key);
const INTAKE = "sales/order-intake";
const intakeTile = salesReportTiles.find((t) => t.to.endsWith(INTAKE))!;

describe("Rapor kapısı — karo · şerit · palet", () => {
  beforeEach(() => {
    closed = [];
  });

  it("§0 körlük zemini: satış kategorisinde birden çok rapor var ve karo listesi katalogla örtüşüyor", () => {
    expect(SALES_KEYS.length).toBeGreaterThan(1);
    expect(intakeTile).toBeDefined();
    expect(salesReportTiles.length).toBe(SALES_KEYS.length);
  });

  it("§1 ⭐ alt karo: kapalı rapor çizilmez, açıklar kalır; liste null → hiçbiri", () => {
    closed = [INTAKE];
    const { unmount } = renderWithProviders(<ReportHubGrid title="Satış" tiles={salesReportTiles} />);
    expect(screen.queryByText(intakeTile.title)).toBeNull();
    const other = salesReportTiles.find((t) => t !== intakeTile)!;
    expect(screen.getByText(other.title)).toBeInTheDocument();
    unmount();
    closed = null;
    renderWithProviders(<ReportHubGrid title="Satış" tiles={salesReportTiles} />);
    for (const t of salesReportTiles) expect(screen.queryByText(t.title)).toBeNull();
  });

  it("§2 ⭐ üst karo: kategorinin BÜTÜN raporları kapalıysa kategori karosu yok; biri açıksa var", () => {
    closed = SALES_KEYS;
    const { unmount } = renderWithProviders(<ReportsHubPage />);
    expect(screen.queryByText("Sipariş & Sevkiyat")).toBeNull();
    expect(screen.getByText("Üretim")).toBeInTheDocument(); // kontrol grubu: dokunulmayan kategori duruyor
    unmount();
    closed = SALES_KEYS.slice(1);
    renderWithProviders(<ReportsHubPage />);
    expect(screen.getByText("Sipariş & Sevkiyat")).toBeInTheDocument();
  });

  it("§3 sağ şerit kapalı raporu listelemez (aynı yüklem)", async () => {
    closed = [INTAKE];
    const { ReportSideRail } = await import("./_components/ReportSideRail");
    const { MemoryRouter } = await import("react-router-dom");
    const { render } = await import("@testing-library/react");
    render(
      <MemoryRouter initialEntries={["/reports/sales/order-cancellation"]}>
        <ReportSideRail />
      </MemoryRouter>,
    );
    expect(screen.queryByText(intakeTile.title)).toBeNull();
    expect(screen.getByText(salesReportTiles.find((t) => t.to.endsWith("order-cancellation"))!.title)).toBeInTheDocument();
  });

  it("§4 ⭐ palet: kapalı raporun girişi görünmez; kategorinin hepsi kapalıysa başlık girişi de görünmez", () => {
    const sales = reportCommandSections.find((s) => s.heading.endsWith("Sipariş & Sevkiyat"))!;
    const hub = sales.entries[0]!;
    const intake = sales.entries.find((e) => e.to.endsWith(INTAKE))!;
    closed = [INTAKE];
    expect(intake.visibleWhen?.(ctx())).toBe(false);
    expect(hub.visibleWhen?.(ctx())).toBe(true);
    const other = sales.entries.find((e) => e !== hub && e !== intake)!;
    expect(other.visibleWhen?.(ctx())).toBe(true);
    closed = SALES_KEYS;
    expect(hub.visibleWhen?.(ctx())).toBe(false);
  });

  it("§5 palet: modül kapısı korunur — dokuma kapalıyken dokuma raporu açık listede olsa da görünmez", () => {
    const dokuma = reportCommandSections.find((s) => s.heading.endsWith("Dokuma"))!;
    const off: OperationsVisibilityContext = { ...ctx(), dokumaEnabled: false };
    for (const e of dokuma.entries) expect(e.visibleWhen?.(off)).toBe(false);
    for (const e of dokuma.entries) expect(e.visibleWhen?.(ctx())).toBe(true);
  });
});
