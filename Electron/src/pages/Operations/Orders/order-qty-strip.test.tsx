// Adnan Şahin 2.11.5/1.3.10 denemesi (2026-11-04): (1) sipariş özet şeridinin "Hepsi
// gönderildi" rozeti elle kapatılanları da sayıyor → etiket süzgeçle aynı, tek kaynaktan;
// (2) yan panelde kapsama "668", başlık "668,3" diyordu → miktar her yüzeyde aynı biçim.
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
import { ORDER_SEVK_FILTER_OPTIONS, orderQtyNumber, orderQtyText, orderSevkBucketLabel } from "./order-cell-text";

function withQuery(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("özet şeridi kova etiketi = süzgeç etiketi", () => {
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
    expect(screen.getByText("Henüz gönderilmedi")).toBeTruthy();
  });

  it("şerit ve süzgeç aynı fonksiyondan", () => {
    for (const o of ORDER_SEVK_FILTER_OPTIONS) expect(o.label).toBe(orderSevkBucketLabel(o.value));
  });
});

describe("sipariş miktarı tek biçim", () => {
  it("sunucu 'Sevk' cümlesinin kuralı: binlik grup, en çok 2 hane; adet kesirsiz", () => {
    expect(orderQtyNumber(668.3)).toBe("668,3");
    expect(orderQtyNumber(668.333, "MT")).toBe("668,33");
    expect(orderQtyNumber(1200, "MT")).toBe("1.200");
    expect(orderQtyNumber(12.6, "ADET")).toBe("13");
    expect(orderQtyText(668.3, "MT")).toBe("668,3 m");
    expect(orderQtyText(2.5, "KG")).toBe("2,5 kg");
  });

  it("kapsama paneli sevki başlıkla aynı yazar (668,3 — 668 değil)", async () => {
    withQuery(<CoveragePanel lineIds={["l1"]} />);
    expect(await screen.findByText("668,3")).toBeTruthy();
    expect(screen.getByText("100,25")).toBeTruthy();
    expect(screen.getByText("1.200")).toBeTruthy();
    expect(screen.queryByText("668")).toBeNull();
  });
});
