// Adnan 2026-11-04 E2E bulguları main'de: (1) özet şeridinin "Hepsi gönderildi" kovası elle
// kapatılanları da sayar → etiket süzgeçle aynı; (2) yan panel başlığı "668,3", kapsama "668"
// diyordu → miktar her yüzeyde tek biçimleyiciden (`fmtNum`).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("framer-motion", async (orig) => ({
  ...(await orig<typeof import("framer-motion")>()),
  // Sayma animasyonu yok → son değer hemen yazılır (ölçülen metin = kullanıcının gördüğü).
  useReducedMotion: () => true,
}));
vi.mock("@/pages/Operations/WorkOrders/service", () => ({
  workOrderService: {
    getCoverage: vi.fn(async () => ({
      success: true,
      data: [
        {
          lineId: "l1",
          item: { id: "i1", code: "K", name: "Tül" },
          color: null,
          width: null,
          requested: 1200,
          shipped: 668.3,
          inProduction: 100.25,
          freeWarehouse: 0,
          freeStock: 0,
          netGap: 431.45,
        },
      ],
    })),
  },
}));

import { OrdersStats } from "./OrdersStats";
import { CoveragePanel } from "@/pages/Operations/WorkOrders/CoveragePanel";
import { fmtNum } from "./order-where-text";

function withQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("özet şeridi kova etiketi", () => {
  it("'Hepsi gönderildi' rozeti 'Hepsi gönderildi ya da elle kapatıldı' der", () => {
    render(
      <OrdersStats
        data={{
          totalCount: 5,
          byStatus: { APPROVED: 2, COMPLETED: 3 },
          totalOrderedQty: 0,
          totalShippedQty: 0,
          totalOpenQty: 0,
          overdueCount: 0,
          dueThisWeekCount: 0,
          noWorkOrderCount: 0,
          amountByCurrency: {},
        }}
        isLoading={false}
        scopeLabel="Tümü"
        view="sade"
        onViewChange={() => {}}
        viewLocked={false}
        pricingEnabled={false}
        onApplyFilter={() => {}}
      />,
    );
    expect(screen.getByText("Hepsi gönderildi ya da elle kapatıldı")).toBeTruthy();
    expect(screen.queryByText("Hepsi gönderildi")).toBeNull();
  });
});

describe("sipariş miktarı tek biçim", () => {
  it("fmtNum: binlik grup, en çok 2 ondalık", () => {
    expect(fmtNum(668.3)).toBe("668,3");
    expect(fmtNum(668.333)).toBe("668,33");
    expect(fmtNum(1200)).toBe("1.200");
  });

  it("kapsama paneli sevki başlıkla aynı yazar (668,3 — 668 değil)", async () => {
    withQuery(<CoveragePanel lineIds={["l1"]} />);
    expect(await screen.findByText("668,3")).toBeTruthy();
    expect(screen.getByText("100,25")).toBeTruthy();
    expect(screen.getByText("1.200")).toBeTruthy();
    expect(screen.queryByText("668")).toBeNull();
  });

  it("yan panel miktarları aynı biçimleyiciden (toLocaleString kopyası yok)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "OrderDetailSheet.tsx"), "utf8");
    expect(src).not.toMatch(/Qty\.toLocaleString|quantity\.toLocaleString/);
    // Sevk İlerlemesi listedeki "Metre" ile aynı kaynaktan; o kaynak da fmtNum ile biçimler.
    expect(src).toMatch(/\{metreParts\.qty\}/);
    expect(src).toMatch(/orderMetreParts\(order\)/);
    const cell = readFileSync(resolve(__dirname, "order-cell-text.ts"), "utf8");
    expect(cell).toMatch(/qty: `\$\{fmtNum\(p\.shipped\)\} \/ \$\{fmtNum\(p\.requested\)\} m`/);
  });
});
