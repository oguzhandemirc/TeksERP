import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { SystemLogIslem } from "@/types/systemLog";

// "Reddedilenler" çipi (izlenebilirlik B4): süzme SUNUCUDA (`reddedilen=1`); eski backend
// parametreyi yok sayar → yanıtta `reddedilenSuzgeci` yoksa çip hiç görünmez.
// Sondalar (2026-10-26, md5 geri): buildFeedParams `reddedilen`i göndermez → 2 ❌ · ActivityPage
// listeyi istemcide süzer → 2 ❌ (bu dosya + activity-view "süzmez") · çip işaretsiz de görünür → 1 ❌.

const feed = vi.fn();
vi.mock("@/services/systemLogService", () => ({
  systemLogService: {
    feed: (...a: unknown[]) => feed(...a),
    users: () => Promise.resolve({ data: [] }),
    tables: () => Promise.resolve({ data: [] }),
    getIslem: () => Promise.resolve({ success: false, data: null }),
    findById: () => Promise.resolve({ success: false, data: null }),
  },
}));
vi.mock("@/pages/Reports/_v2/RelocatedTools", () => ({ RelocatedToolStrip: () => null }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/components/data-table/ListExportMenu", () => ({ ListExportMenu: () => null }));

import { ActivityPage } from "./ActivityPage";

const islem = (id: string, reddedildi: boolean): SystemLogIslem => {
  const metin = reddedildi ? `Ahmet Y. sevkiyatı onaylamaya çalıştı — reddedildi: başka biri değiştirmiş (CONFLICT) ${id}` : `Ahmet Y. siparişi düzenledi ${id}`;
  return { id, requestId: id, createdAt: "2026-10-26T08:00:00Z", user: null, kayitSayisi: 0, reddedildi, iz: null, satirlar: [], anlati: { metin, parcalar: [{ t: "metin", text: metin }] } };
};
const yanit = (data: SystemLogIslem[], destek: boolean) => ({
  success: true, data, pagination: { nextCursor: null, hasMore: false, limit: 50 }, ...(destek ? { reddedilenSuzgeci: true } : {}),
});

function ciz() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Etkinlik — Reddedilenler çipi", () => {
  beforeEach(() => feed.mockReset());

  it("eski backend (işaret yok): çip gizli, `reddedilen` gönderilmez", async () => {
    feed.mockResolvedValue(yanit([islem("a1", false)], false));
    ciz();
    await screen.findByText(/siparişi düzenledi a1/);
    expect(screen.queryByRole("button", { name: /Reddedilenler/ })).toBeNull();
    expect(feed.mock.calls[0]?.[0]?.reddedilen).toBeUndefined();
  });

  it("yeni backend: çipe basınca `reddedilen: 1` gider; dönen liste istemcide süzülmez", async () => {
    feed.mockResolvedValueOnce(yanit([islem("a1", false)], true));
    // Sunucu ne dönerse o çizilir (süzme sunucuda) — reddedilmemiş öğe de görünür kalır.
    feed.mockResolvedValue(yanit([islem("r1", true), islem("a2", false)], true));
    ciz();
    const cip = await screen.findByRole("button", { name: /Reddedilenler/ });
    expect(cip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(cip);
    await screen.findByText(/reddedildi: başka biri değiştirmiş \(CONFLICT\) r1/);
    expect(screen.getByText(/siparişi düzenledi a2/)).toBeTruthy();
    expect(feed.mock.calls.at(-1)![0]).toMatchObject({ gorunum: "islem", reddedilen: 1 });
    await waitFor(() => expect(screen.getByRole("button", { name: /Reddedilenler/ }).getAttribute("aria-pressed")).toBe("true"));
  });
});
