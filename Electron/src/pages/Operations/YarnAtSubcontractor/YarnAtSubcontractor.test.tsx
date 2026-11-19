// =============================================================================
// BEKÇİ — Fasondaki İplik ekranı + iplik kartı "Nerede?" + fasoncu kartı iplik bakiyesi (devere D6c)
// =============================================================================
//   ① Ekran: satırlar, devreden rozeti, sipariş bağı, özet şeridi (toplam kg, fasoncu sayısı, devreden).
//   ② Süzgeç SUNUCUDA: URL `filter[...]` → istek parametresi aynen; boş durum süzgeçli/süzgeçsiz ayrı cümle.
//   ③ Kart bölümleri modül + izin kapılı: devere/iplik kapalı ya da izin yoksa HİÇ çizilmez ve istek atılmaz.
//   ④ Karo devere kapısıyla gizlenir (Leventler ile aynı yüklem nesnesi).
// =============================================================================
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { YarnAtSubRow } from "./service";

let flags: Record<string, boolean> = {};
let perms: string[] = [];
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: flags } }),
  useDevereEnabled: () => Boolean(flags.devereEnabled && flags.iplikEnabled),
  useEmanetEnabled: () => Boolean(flags.emanetEnabled),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/data-table/filter-row/FilterRow", () => ({ FilterRow: () => <div data-testid="filter-row" /> }));

// apiClient düzeyinde: istek URL'sindeki `filter[...]` sunucuya giden süzgeçtir (istemcide süzme yok).
const list = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: {
    get: async (url: string) => {
      const u = new URL(url, "http://x");
      const f: Record<string, string | undefined> = {};
      for (const [k, v] of u.searchParams) f[k.replace(/^filter\[(.*)\]$/, "$1")] = v;
      return { data: { success: true, data: await list(f) } };
    },
  },
}));
const stocks = vi.fn();
vi.mock("../Yarn/service", async (orig) => ({ ...(await orig<typeof import("../Yarn/service")>()), listYarnStocks: (p: unknown) => stocks(p) }));

import { YarnAtSubcontractorPage } from "./YarnAtSubcontractorPage";
import { YarnWhereSection } from "./YarnWhereSection";
import { SubcontractorYarnSection } from "./SubcontractorYarnSection";
import { operationsTiles } from "../tile-config";
import { isWarpBeamsVisible } from "../WarpBeams/warp-beam-regime";

const ROWS: YarnAtSubRow[] = [
  {
    subcontractorId: "s1", subcontractorCode: "DV1", subcontractorName: "Alfa Devere", yarnItemId: "y1", yarnItemCode: "PES50", yarnItemName: "PES 50 denye",
    lotId: "l1", lotNo: "LOT-77", ownerCustomerId: "c1", ownerCustomerName: "Müşteri Tekstil", kg: "120.500", oldestDispatchedAt: "2026-10-01T08:00:00Z",
    orders: [
      { warpingOrderId: "o1", orderNo: "FDV0001", status: "COMPLETED", kg: "20.500" },
      { warpingOrderId: "o2", orderNo: "FDV0002", status: "IN_PROGRESS", kg: "100.000" },
    ],
  },
  {
    subcontractorId: "s2", subcontractorCode: "DV2", subcontractorName: "Beta Çözgü", yarnItemId: "y1", yarnItemCode: "PES50", yarnItemName: "PES 50 denye",
    lotId: null, lotNo: null, ownerCustomerId: null, ownerCustomerName: null, kg: "30.000", oldestDispatchedAt: "2026-11-17T08:00:00Z",
    orders: [{ warpingOrderId: "o3", orderNo: "FDV0003", status: "IN_PROGRESS", kg: "30.000" }],
  },
];

beforeEach(() => {
  flags = { devereEnabled: true, iplikEnabled: true, emanetEnabled: true, productionEnabled: true, ticaretEnabled: true, financeEnabled: true };
  perms = ["warping-order:read", "warehouse:read"];
  list.mockReset().mockResolvedValue(ROWS);
  stocks.mockReset().mockResolvedValue({ data: [{ id: "st1", balanceKg: "400.000", updatedAt: "2026-11-10T08:00:00Z", item: { id: "y1", code: "PES50", name: "PES 50 denye", unit: "KG" }, warehouse: { id: "w1", code: "ANA", name: "Ana Depo" } }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 }, totals: { balanceKg: "400.000" } });
});

describe("Fasondaki İplik ekranı", () => {
  it("① satırlar + devreden + sipariş bağı + özet şeridi", async () => {
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    expect(await screen.findByText("LOT-77")).toBeInTheDocument();
    // Tek terim, kesilmeden; açıklama ipucunda (eski "devreden · sipariş kapandı" dar sütunda kırpılıyordu).
    const badge = screen.getByText("devreden");
    expect(badge).toHaveAttribute("title", expect.stringMatching(/Siparişi kapanmış/));
    expect(screen.queryByText(/devreden ·/)).toBeNull();
    // İplik ADI birincil, kod ikinci satır + tam metin ipucunda.
    expect(screen.getAllByText("PES 50 denye").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("PES 50 denye (PES50)").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "FDV0001" })).toHaveAttribute("href", "/operations/fason-devere/o1");
    expect(screen.getByText("Müşteri Tekstil")).toBeInTheDocument();
    expect(screen.getByText("Bizim")).toBeInTheDocument();
    const band = screen.getByRole("group", { name: "Fasondaki iplik özeti" });
    expect(band).toHaveTextContent("150,50");
    expect(band).toHaveTextContent("Fasoncu2");
    expect(band).toHaveTextContent("Devreden20,50");
  });

  it("② süzgeç URL'den sunucuya; süzgeçli boş durum ayrı cümle", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik?filter[subcontractorId]=s9&filter[status]=COMPLETED" });
    expect(await screen.findByText(/Bu süzgece ya da aramaya uyan fasondaki iplik yok/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ subcontractorId: "s9", status: "COMPLETED" });
  });

  it("② süzgeçsiz boş durum", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    expect(await screen.findByText(/Şu an hiçbir fasoncuda iplik yok/)).toBeInTheDocument();
  });

  it("lot süzgeci URL'den sunucuya (filter[lotId])", async () => {
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik?filter[lotId]=l1" });
    await screen.findByText("LOT-77");
    expect(list).toHaveBeenCalledWith({ lotId: "l1" });
  });

  it("değer: izinsiz sütun ve özet yok; goods-receipt:read ile satır değeri + para birimi başına toplam + fiyatsız sayısı", async () => {
    const priced: YarnAtSubRow[] = [
      { ...ROWS[0]!, priceStatus: "PRICE", unitPrice: "2.9000", currency: "USD", value: "349.45" },
      { ...ROWS[1]!, priceStatus: "NO_LOT", unitPrice: null, currency: null, value: null },
    ];
    list.mockResolvedValue(priced);
    const r = renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    await screen.findByText("LOT-77");
    expect(screen.queryAllByText("Değer")).toHaveLength(0); // sütun başlığı (tam metin)
    expect(screen.getByRole("group", { name: "Fasondaki iplik özeti" })).not.toHaveTextContent("Değer");
    r.unmount();
    perms = [...perms, "goods-receipt:read"];
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    await screen.findByText("LOT-77");
    expect(screen.getAllByText("Değer").length).toBeGreaterThan(0);
    const band = screen.getByRole("group", { name: "Fasondaki iplik özeti" });
    expect(band).toHaveTextContent("Değer (USD)349,45");
    expect(band).toHaveTextContent("Fiyatsız1");
    expect(screen.getByTitle(/Lotsuz iplik/)).toHaveTextContent("—");
  });

  it("satır eylemleri yalnız warping-order:write ile", async () => {
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    await screen.findByText("LOT-77");
    expect(screen.queryByRole("button", { name: /iade al/ })).toBeNull();
    perms = [...perms, "warping-order:write"];
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    expect((await screen.findAllByRole("button", { name: /iade al/ })).length).toBe(2);
    expect(screen.getAllByRole("button", { name: /başka siparişe aktar/ }).length).toBe(2);
  });

  it("Fasoncu ekstresi düğmesi pencereyi açar", async () => {
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    await screen.findByText("LOT-77");
    screen.getByRole("button", { name: /Fasoncu ekstresi/ }).click();
    expect(await screen.findByRole("radiogroup", { name: "Fasoncu" })).toBeInTheDocument();
  });

  it("emanet kapalı → Sahibi sütunu yok", async () => {
    flags.emanetEnabled = false;
    renderWithProviders(<YarnAtSubcontractorPage />, { route: "/operations/fasondaki-iplik" });
    await screen.findByText("LOT-77");
    expect(screen.queryByText("Müşteri Tekstil")).toBeNull();
  });
});

describe("iplik kartı — Nerede?", () => {
  it("③ depo + fason bölümleri, fason bağı ipliğe süzülü ekrana", async () => {
    renderWithProviders(<YarnWhereSection itemId="y1" itemType="YARN" />);
    expect(await screen.findByText("Ana Depo")).toBeInTheDocument();
    expect(await screen.findByText("Alfa Devere")).toBeInTheDocument();
    expect(screen.getByText(/devreden var/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Fasondaki İplik ekranında aç/ }).getAttribute("href")).toContain("filter[yarnItemId]=y1");
    expect(list).toHaveBeenCalledWith({ yarnItemId: "y1" });
  });
  it("③ kumaş kartında, devere+iplik kapalıyken ya da izinsiz hiç çizilmez", async () => {
    const { container, unmount } = renderWithProviders(<YarnWhereSection itemId="f1" itemType="FABRIC" />);
    expect(container.querySelector("[data-testid=yarn-where]")).toBeNull();
    unmount();
    flags = { productionEnabled: true };
    const r2 = renderWithProviders(<YarnWhereSection itemId="y1" itemType="YARN" />);
    expect(r2.container.querySelector("[data-testid=yarn-where]")).toBeNull();
    r2.unmount();
    flags = { devereEnabled: true, iplikEnabled: true, ticaretEnabled: true, financeEnabled: true, productionEnabled: true };
    perms = [];
    const r3 = renderWithProviders(<YarnWhereSection itemId="y1" itemType="YARN" />);
    expect(r3.container.querySelector("[data-testid=yarn-where]")).toBeNull();
    await waitFor(() => expect(list).not.toHaveBeenCalled());
    expect(stocks).not.toHaveBeenCalled();
  });
});

describe("fasoncu kartı — iplik bakiyesi", () => {
  it("③ satırlar + devreden notu; kapalıyken yok", async () => {
    list.mockResolvedValue(ROWS.slice(0, 1));
    const r = renderWithProviders(<SubcontractorYarnSection subcontractorId="s1" />);
    expect(await screen.findByText("PES 50 denye")).toBeInTheDocument();
    expect(screen.getByText(/20,50 kg devreden/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ subcontractorId: "s1" });
    r.unmount();
    flags.devereEnabled = false;
    list.mockClear();
    renderWithProviders(<SubcontractorYarnSection subcontractorId="s1" />);
    expect(screen.queryByText("Bu fasoncudaki iplik")).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("karo", () => {
  it("④ devere kapısı + izin", () => {
    const t = operationsTiles.find((x) => x.key === "fasondaki-iplik");
    expect(t?.visibleWhen).toBe(isWarpBeamsVisible);
    expect(t?.permission).toBe("warping-order:read");
    expect(t?.to).toBe("/operations/fasondaki-iplik");
  });
});
