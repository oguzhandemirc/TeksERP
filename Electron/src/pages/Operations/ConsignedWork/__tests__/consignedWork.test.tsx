// P1a İçerideki İşler (ister 3.2): tablo + toplam şeridi, satır/hücre bağlantısı sahip süzgeciyle Kumaş Stoğu'na,
// bulunabilirlik (karo · palet · modül tablosu) ve top listesi "Sahibi" çipinin emanet bayrağına bağlılığı.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { buildRollFilterDefs } from "@/pages/Operations/Rolls/RollsTableBody";
import { ConsignedWorkPage } from "../ConsignedWorkPage";
import { primaryBucket, rollsLinkFor } from "../consigned-links";
import type { ConsignedOwnerRow, ConsignedWorkSummary } from "../service";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));

const get = vi.fn();
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  getConsignedWork: () => get(),
}));

const b = (count: number, qty: number) => ({ count, qty });
const rowA: ConsignedOwnerRow = {
  ownerCustomerId: "cA", ownerName: "Gül Perde",
  waiting: b(2, 300), inProcess: b(5, 750), ready: b(1, 120), other: b(0, 0), total: b(8, 1170),
};
const summary: ConsignedWorkSummary = {
  rows: [rowA],
  totals: { waiting: b(2, 300), inProcess: b(5, 750), ready: b(1, 120), other: b(0, 0), total: b(8, 1170) },
};

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue(summary);
});

describe("İçerideki İşler", () => {
  it("müşteri satırı ve toplam şeridi sunucu özetini basar", async () => {
    renderWithProviders(<ConsignedWorkPage />);
    expect(await screen.findByText("Gül Perde")).toBeInTheDocument();
    expect(screen.getAllByText("8 top").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/^1170(,0)? m$/).length).toBeGreaterThanOrEqual(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("hücre bağlantısı kovanın sekmesine sahip süzgeciyle gider", async () => {
    renderWithProviders(<ConsignedWorkPage />);
    await screen.findByText("Gül Perde");
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
    expect(links.some((h) => h.includes("tab=FINISHED_STOCK") && h.includes("filter%5BownerCustomerId%5D=cA"))).toBe(true);
  });

  it("boş özet 'içeride emanet mal yok' der; hata 'yüklenemedi' der (boş sanılmaz)", async () => {
    get.mockResolvedValueOnce({ rows: [], totals: summary.totals });
    const { unmount } = renderWithProviders(<ConsignedWorkPage />);
    expect(await screen.findByText(/İçeride emanet mal yok/)).toBeInTheDocument();
    unmount();
    get.mockRejectedValueOnce(new Error("403"));
    renderWithProviders(<ConsignedWorkPage />);
    await waitFor(() => expect(screen.getByText("Liste yüklenemedi.")).toBeInTheDocument());
  });

  it("satır tıklaması en kalabalık kovaya gider; bağlantı includeFire taşır", () => {
    expect(primaryBucket(rowA)).toBe("inProcess");
    expect(primaryBucket({ ...rowA, inProcess: b(0, 0), ready: b(4, 10) })).toBe("ready");
    const url = rollsLinkFor("cA", "waiting");
    expect(url.startsWith("/operations/rolls?")).toBe(true);
    const sp = new URLSearchParams(url.split("?")[1]);
    expect(sp.get("tab")).toBe("RAW_STOCK");
    expect(sp.get("filter[ownerCustomerId]")).toBe("cA");
    expect(sp.get("filter[includeFire]")).toBe("true");
  });

  it("bulunabilir: karo (emanet bayrağına bağlı) · palet · modül tablosu", () => {
    const tile = operationsTiles.find((t) => t.to === "/operations/icerideki-isler");
    expect(tile?.permission).toBe("roll:read");
    expect(tile?.visibleWhen?.({ emanetEnabled: true } as never)).toBe(true);
    expect(tile?.visibleWhen?.({ emanetEnabled: false } as never)).toBe(false);
    expect(allCommandEntries.some((e) => e.to === "/operations/icerideki-isler")).toBe(true);
    expect(ROUTE_MODULE["operations/icerideki-isler"]).toBe("emanetEnabled");
  });

  it("top listesi 'Sahibi' çipi yalnız emanet açıkken listede", () => {
    const keys = (on: boolean) => buildRollFilterDefs("RAW_STOCK", [], false, on).flatMap((f) => ("key" in f ? [f.key] : []));
    expect(keys(true)).toContain("ownerCustomerId");
    expect(keys(false)).not.toContain("ownerCustomerId");
  });
});
