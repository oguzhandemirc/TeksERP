// =============================================================================
// RAPOR KAPISI — KARO · ŞERİT · PALET (Raporlar K5, üç yolun birinci ve üçüncüsü)
// =============================================================================
// Üç yüzey aynı yüklemi okur (`isReportOpen` / `categoryHasOpenReport`): kapalı rapor alt
// karoda, sağ şeritte ve komut paletinde yoktur; bütün raporları kapalı kategori palet başlığında
// yoktur (eski karo sayfası 2026-11-12'de kalktı, §2 onunla gitti). Yüklem ctx'te; bu test ctx'i sahteler ve yüzeylerin ona
// UYDUĞUNU ölçer (ctx'in kendisi `report-gate.test.ts` + `ProtectedRoute.report.test.tsx`).
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `ReportHubGrid`ten süzme
// kaldırıldı → §1 ❌; palet alt girişinin `visibleWhen`i eski hâline (yalnız modül) döndürüldü → §4 ❌.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import { isReportOpenWith, isReportOnPanel } from "@/lib/report-gate";

let closed: string[] | null = [];
const ctx = (): OperationsVisibilityContext => ({
  shipmentConfirmationEnabled: false,
  depoMultiEnabled: false,
  devereEnabled: false,
  dokumaEnabled: true, machineStopEnabled: true, tezgahEnabled: true, kaliteGuvenceEnabled: false, maliyetEnabled: false, gelenBelgeEnabled: false, emanetEnabled: false,
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
import { financeReportTiles } from "./Finance/tile-config";
import { reportCommandSections } from "@/components/layout/command-entries.reports";

// Karo taşıyan satırlar: ucu inmemiş v2 satırı (`hazir:false`) bugün hiçbir yüzeyde çizilmez.
// Ön Muhasebe karoları uzman v1 satırlarıdır (satış karoları 2026-11-12'de eski raporlarla kalktı);
// hazır v2 satırları Rapor Merkezi'nde (genel v2 yaprağı) çizilir.
// Kendi sayfalı v2 satırı (masraf özeti, `V2_KEYS_WITH_OWN_PAGE`) da karo taşır.
const CAT_KEYS = REPORT_CATALOG.filter((r) => r.key.startsWith("finance/") && r.panelYolu.startsWith("reports/") && isReportOnPanel(r))
  .filter((r) => r.nesil !== "v2" || r.key === "finance/masraf-ozeti").map((r) => r.key);
/** Kategori kapısı ve palet v2 satırlarını da sayar: "hepsi kapalı" bu kümedir. */
const CAT_ALL = REPORT_CATALOG.filter((r) => r.key.startsWith("finance/") && isReportOnPanel(r)).map((r) => r.key);
const INTAKE = "finance/cash-book";
const intakeTile = financeReportTiles.find((t) => t.to.endsWith(INTAKE))!;

describe("Rapor kapısı — karo · şerit · palet", () => {
  beforeEach(() => {
    closed = [];
  });

  it("§0 körlük zemini: Ön Muhasebe kategorisinde birden çok rapor var ve karo listesi katalogla örtüşüyor", () => {
    expect(CAT_KEYS.length).toBeGreaterThan(1);
    expect(intakeTile).toBeDefined();
    expect(financeReportTiles.length).toBe(CAT_KEYS.length);
  });

  it("§1 ⭐ alt karo: kapalı rapor çizilmez, açıklar kalır; liste null → hiçbiri", () => {
    closed = [INTAKE];
    const { unmount } = renderWithProviders(<ReportHubGrid title="Ön Muhasebe" tiles={financeReportTiles} />);
    expect(screen.queryByText(intakeTile.title)).toBeNull();
    const other = financeReportTiles.find((t) => t !== intakeTile)!;
    expect(screen.getByText(other.title)).toBeInTheDocument();
    unmount();
    closed = null;
    renderWithProviders(<ReportHubGrid title="Ön Muhasebe" tiles={financeReportTiles} />);
    for (const t of financeReportTiles) expect(screen.queryByText(t.title)).toBeNull();
  });

  it("§3 sağ şerit kapalı raporu listelemez (aynı yüklem)", async () => {
    closed = [INTAKE];
    const { ReportSideRail } = await import("./_components/ReportSideRail");
    const { MemoryRouter } = await import("react-router-dom");
    const { render } = await import("@testing-library/react");
    render(
      <MemoryRouter initialEntries={["/reports/finance/vat-summary"]}>
        <ReportSideRail />
      </MemoryRouter>,
    );
    expect(screen.queryByText(intakeTile.title)).toBeNull();
    expect(screen.getByText(financeReportTiles.find((t) => t.to.endsWith("vat-summary"))!.title)).toBeInTheDocument();
  });

  it("§4 ⭐ palet: kapalı raporun girişi görünmez; kategorinin hepsi kapalıysa başlık girişi de görünmez", () => {
    const sales = reportCommandSections.find((s) => s.heading.endsWith("Ön Muhasebe"))!;
    const hub = sales.entries[0]!;
    // Palette eski yaprak "Eski:" ikiziyle görünür (özgün giriş yalnız sekme başlığı kaynağı).
    const twins = sales.entries.filter((e) => e.key.endsWith(":legacy"));
    const intake = twins.find((e) => e.to.endsWith(INTAKE))!;
    closed = [INTAKE];
    expect(intake.visibleWhen?.(ctx())).toBe(false);
    expect(hub.visibleWhen?.(ctx())).toBe(true);
    const other = twins.find((e) => e !== intake)!;
    expect(other.visibleWhen?.(ctx())).toBe(true);
    closed = CAT_ALL;
    expect(hub.visibleWhen?.(ctx())).toBe(false);
  });

  it("§5 palet: modül kapısı korunur — dokuma kapalıyken dokuma raporu açık listede olsa da görünmez", () => {
    const dokuma = reportCommandSections.find((s) => s.heading.endsWith("Dokuma"))!;
    const off: OperationsVisibilityContext = { ...ctx(), dokumaEnabled: false };
    for (const e of dokuma.entries) expect(e.visibleWhen?.(off)).toBe(false);
    // Palette eski yaprak yalnız "Eski:" ikiziyle görünür (özgün giriş sekme başlığı kaynağı); ikiz modül kapısını taşır.
    const isLeaf = (k: string) => k.split(":").length >= 3 && !k.endsWith(":legacy");
    for (const e of dokuma.entries) expect(e.visibleWhen?.(ctx())).toBe(!isLeaf(e.key));
    expect(dokuma.entries.some((e) => e.key.endsWith(":legacy"))).toBe(true);
  });
});
