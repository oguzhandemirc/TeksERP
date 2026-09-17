// =============================================================================
// HUB BAYRAK BEKLEME — pending'de modüllü karo NE gizli NE görünür: İSKELET (titreme sıfır)
// =============================================================================
// `flagsReady` route kapısını bekletti (24f2c1b6); karolar hâlâ `?? false` ile süzülüp
// sorgu dolunca BELİRİYORDU. Dört hub (Operasyon · Tanımlar · Raporlar · rapor kategorisi)
// bayraklar gelene dek gövde yerine `HubSkeleton` çizer; dolunca karolar, iskelet yok.
//
// Negatif sonda (bir kezlik, geri alındı — sha commit mesajında): `OperationsHubPage`te
// `!flagsReady` dalı düşürüldü → §1 Operasyon "pending'de karo yok" ❌ (çekirdek karolar belirdi).
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

let ready = true;
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false,
    financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: false,
    reportsClosedKeys: ready ? [] : null,
    isReportOpen: () => ready,
    flagsReady: ready,
    flagsFailed: false,
  }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));

import { OperationsHubPage } from "@/pages/Operations/OperationsHubPage";
import { DefinitionsHubPage } from "@/pages/Definitions/DefinitionsHubPage";
import { ReportsHubPage } from "@/pages/Reports/ReportsHubPage";
import { ReportHubGrid } from "@/pages/Reports/_components/ReportHubGrid";
import { salesReportTiles } from "@/pages/Reports/Sales/tile-config";

// HubCard kökü `<button class="group block …">`; başlık düğmeleri (yenile · favori) bu sınıfı taşımaz.
const cards = (c: HTMLElement) => c.querySelectorAll("button.group.block");
const skeleton = () => screen.queryByTestId("hub-iskelet");

function both(name: string, ui: () => React.ReactElement) {
  it(`${name}: pending → iskelet var, karo YOK; ready → karolar var, iskelet YOK`, () => {
    ready = false;
    const p = renderWithProviders(ui());
    expect(skeleton(), "pending'de iskelet").not.toBeNull();
    expect(cards(p.container), "pending'de karo").toHaveLength(0);
    p.unmount();
    ready = true;
    const r = renderWithProviders(ui());
    expect(skeleton(), "ready'de iskelet").toBeNull();
    expect(cards(r.container).length, "ready'de karo").toBeGreaterThan(0);
  });
}

describe("Hub bayrak bekleme — iskelet", () => {
  beforeEach(() => {
    ready = true;
  });
  both("§1 Operasyon hub'ı", () => <OperationsHubPage />);
  both("§2 Tanımlar hub'ı", () => <DefinitionsHubPage />);
  both("§3 Raporlar hub'ı", () => <ReportsHubPage />);
  both("§4 rapor kategorisi (ReportHubGrid)", () => <ReportHubGrid title="Satış" tiles={salesReportTiles} />);
});
