// =============================================================================
// BEKÇİ — Yurtiçi / Yurtdışı Satış sayfası (R2, 2026-09-23)
// =============================================================================
// §1 yön kartları: doğrudan sevk "Yön kaydı yok" GÖRÜNÜR bir kart; kg tartısızsa "ölçülmedi".
// §2 kapsam: fiyat hiç yoksa ekran bunu HATA gibi değil açıkça söyler; kur kaynağı ve ülke kapsamı yazar.
// §3 saf metinler: fiyatsız satır 0 değil "fiyat girilmemiş"; kur yoksa TL'den hariç tutulduğu söylenir.
// =============================================================================
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import { amountText, kgText, tlText, type DestinationMix, type MoneyAgg } from "./destinationMix";

const bos: MoneyAgg = { lineCount: 3, pricedLineCount: 0, amounts: [], tlTotal: 0, noRateLineCount: 0 };
const kova = (k: { bucket: "DOMESTIC" | "EXPORT" | "NONE"; label: string; meters: number; totalSacks: number }) => ({
  ...k, rollCount: 1, shipmentCount: 1, kg: 0, weighedSacks: 0, returnQty: 0, money: bos,
});
const RAPOR: DestinationMix = {
  kapsam: { kurKaynagi: "Kayıtlı kur tablosunun SEVK GÜNÜ satırı", customersInPeriod: 29, customersWithCountry: 1 },
  buckets: [
    kova({ bucket: "DOMESTIC", label: "Yurtiçi", meters: 120, totalSacks: 2 }),
    kova({ bucket: "EXPORT", label: "Yurtdışı", meters: 0, totalSacks: 0 }),
    kova({ bucket: "NONE", label: "Yön kaydı yok (doğrudan sevk)", meters: 15, totalSacks: 0 }),
  ],
  byCustomer: [], byCountry: [], byItem: [], backlog: [], backlogExport: [], fulfillment: [],
};

const get = vi.fn(async () => ({ data: { success: true, data: RAPOR, range: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-23T00:00:00.000Z" } } }));
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...(a as [])), post: vi.fn(), patch: vi.fn() } }));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({ shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, financeEnabled: true, productionEnabled: true, ticaretEnabled: true, iplikEnabled: true, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: () => ({ onClick: () => {}, onAuxClick: () => {}, onContextMenu: () => {} }), useTabTarget: () => ({ onClick: () => {} }) }));
import { DestinationMixPage } from "./DestinationMixPage";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/reports/sales/destination-mix"]}><DestinationMixPage /></MemoryRouter></QueryClientProvider>);
}

describe("DestinationMixPage", () => {
  it("⭐ §1 doğrudan sevk 'Yön kaydı yok' ayrı kart; tartısız kg 'ölçülmedi'", async () => {
    renderPage();
    expect(await screen.findByText("Yön kaydı yok (doğrudan sevk)")).toBeInTheDocument();
    expect(screen.getByText(/kg ölçülmedi \(tartılı 0 \/ 2 çuval\)/)).toBeInTheDocument();
  });
  it("⭐ §2 fiyat hiç yoksa kapsam bunu 'hata değil' diye söyler; kur kaynağı ve ülke kapsamı yazar", async () => {
    renderPage();
    const k = await screen.findByTestId("destination-mix-kapsam");
    expect(k).toHaveTextContent("fiyatlı 0 / 9 tahsis satırı");
    expect(k).toHaveTextContent("bu bir hata değil");
    expect(k).toHaveTextContent("SEVK GÜNÜ");
    expect(k).toHaveTextContent("1 / 29 müşteride dolu");
  });
});

describe("destinationMix metinleri", () => {
  it("⭐ §3 fiyatsız satır 0 değil 'fiyat girilmemiş'; hiç satır yoksa '—'", () => {
    expect(amountText(bos)).toBe("fiyat girilmemiş");
    expect(amountText({ ...bos, lineCount: 0 })).toBe("—");
  });
  it("§3 kur yoksa TL'den hariç tutulduğu söylenir", () => {
    const m: MoneyAgg = { lineCount: 2, pricedLineCount: 2, amounts: [{ currency: "USD", amount: 660, pricedQty: 140, avgUnitPrice: 4.71 }], tlTotal: 15000, noRateLineCount: 1 };
    expect(tlText(m)).toContain("kur yok: 1 satır hariç");
    expect(amountText(m)).toContain("USD 660,00");
  });
  it("§3 kg: çuval yoksa 'ölçülmez', tartılıysa kapsamıyla", () => {
    expect(kgText({ kg: 0, weighedSacks: 0, totalSacks: 0 })).toBe("kg ölçülmez (çuval yok)");
    expect(kgText({ kg: 15, weighedSacks: 2, totalSacks: 2 })).toContain("tartılı 2 / 2");
  });
});
