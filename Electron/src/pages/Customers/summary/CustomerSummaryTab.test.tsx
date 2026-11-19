// =============================================================================
// BEKÇİ — Müşteri kartı "Özet" sekmesi: uç + süzgeç · izin yoksa istek YOK · bölüm yalıtımı ·
// sevk BRÜT / iade ayrı · tutar yalnız finans okuma kapısıyla · boş durum
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { matchesPermission } from "@/types/auth";
import { CustomerSummaryTab } from "./CustomerSummaryTab";

const get = vi.fn();
const openTab = vi.fn();
let perms: string[] = [];
let financeRead = false;

vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a) } }));
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ openTab }) }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => matchesPermission(perms, p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => matchesPermission(perms, p)),
  }),
}));
vi.mock("../CustomerFinanceSection", () => ({
  useCustomerFinanceAccess: () => ({ enabled: financeRead, canRead: financeRead, canWrite: false, canSeeHold: false }),
}));

const CID = "11111111-2222-3333-4444-555555555555";
const ALL = ["order:read", "shipping:read", "return:read"];
const pg = { nextCursor: null, hasMore: false, limit: 10 };

const order = {
  id: "o1", orderNumber: "SIP-001", customerId: CID, branchId: null, currency: "TRY", totalAmount: "98765.43",
  status: "PARTIAL_SHIPPED", shippedQty: 40, orderDate: "2026-11-01T09:00:00Z", deadline: null, manualClosedById: null,
  branch: null, createdAt: "", updatedAt: "",
  lines: [{ id: "l1", quantity: 100, unit: "MT", shippedQty: 40, cancelledAt: null, item: { id: "i1", code: "K1", name: "Penye" } }],
};

type Key = "orders" | "stats" | "open" | "ship" | "ret" | "cari";
type Resp = Record<string, unknown> | Error;

function routes(over: Partial<Record<Key, Resp>> = {}) {
  const r: Record<string, Resp> = {
    stats: { success: true, data: { totalCount: 7, byStatus: {}, totalOrderedQty: 500, totalShippedQty: 200, totalOpenQty: 300, noWorkOrderCount: 0, amountByCurrency: { TRY: 98765.43 } } },
    orders: { success: true, data: [order], pagination: pg },
    open: { success: true, data: [{ order: { id: "o1", orderNumber: "SIP-001", status: "APPROVED", deadline: null, customer: { id: CID, name: "X" }, branch: null }, lines: [{ lineId: "l1", item: { id: "i1", code: "K1", name: "Penye" }, color: null, width: 180, customerItemName: null, customerColorName: null, requested: 100, shipped: 40, openQty: 60, warehouseAvailable: 0, covered: false }] }] },
    ship: { success: true, data: [{ id: "s1", kind: "SHIPMENT", shipmentNo: "SVK-9", status: "DISPATCHED", dispatchedAt: "2026-11-02T10:00:00Z", createdAt: "", customer: { id: CID, code: "C", name: "X" }, branch: null, _count: { sacks: 1, rolls: 3, orders: 1, returns: 1 }, totalMeters: 412.5, totalKg: 80 }], summary: { shipmentCount: 4, totalMeters: 1234.5, totalKg: 210 }, pagination: pg },
    ret: { success: true, data: [{ id: "r1", returnNo: "IAD-1", qty: 12.5, createdAt: "2026-11-03T10:00:00Z", item: { id: "i1", code: "K1", name: "Penye" }, color: null, reason: { id: "x", code: "R", name: "Leke", color: null }, reasonText: null, fromShipment: { id: "s1", shipmentNo: "SVK-9" } }], summary: { count: 2, totalQty: 25 }, pagination: pg },
    cari: { data: { id: "c1", code: "120.01", name: "X", balances: [{ currency: "TRY", balance: 5000 }] } },
    ...over,
  };
  get.mockImplementation((url: string) => {
    const k = url.startsWith("/api/orders/stats") ? "stats"
      : url.startsWith("/api/orders") ? "orders"
      : url.startsWith("/api/shipping/open-orders") ? "open"
      : url.startsWith("/api/shipping/shipments") ? "ship"
      : url.startsWith("/api/returns") ? "ret"
      : url.startsWith("/api/finance/cari/by-customer/") ? "cari" : "?";
    const v = r[k];
    if (!v) return Promise.reject(new Error(`beklenmeyen uç ${url}`));
    return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v });
  });
}

const urls = () => get.mock.calls.map((c) => decodeURIComponent(String(c[0])));
const section = (name: string) => screen.getByRole("region", { name });
const shipmentsReady = () => waitFor(() => expect(within(section("Sevk edilenler")).getByText("SVK-9")).toBeInTheDocument());

beforeEach(() => {
  get.mockReset();
  openTab.mockReset();
  perms = ALL;
  financeRead = false;
});

describe("CustomerSummaryTab", () => {
  it("① her bölüm doğru uca, bu carinin süzgeciyle gider (süzme sunucuda)", async () => {
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await shipmentsReady();
    const u = urls();
    expect(u.some((x) => x.startsWith("/api/orders?") && x.includes(`filter[customerId]=${CID}`) && x.includes("filter[hideCancelled]=true"))).toBe(true);
    expect(u.some((x) => x.startsWith("/api/orders/stats") && x.includes(`filter[customerId]=${CID}`))).toBe(true);
    expect(u.some((x) => x.startsWith("/api/shipping/shipments") && x.includes("filter[status]=DISPATCHED") && x.includes("withSummary=true"))).toBe(true);
    expect(u.some((x) => x.startsWith("/api/returns") && x.includes("withTotal=true") && x.includes(`filter[customerId]=${CID}`))).toBe(true);
  });

  it("② izni olmayan bölüm çizilmez ve isteği atılmaz", async () => {
    perms = ["order:read"];
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await waitFor(() => expect(within(section("Son siparişler")).getByText("SIP-001")).toBeInTheDocument());
    expect(urls().some((x) => x.startsWith("/api/shipping") || x.startsWith("/api/returns"))).toBe(false);
    expect(screen.queryByRole("region", { name: "Sevk edilenler" })).toBeNull();
    expect(screen.queryByRole("region", { name: "İadeler" })).toBeNull();
  });

  it("③ şerit sunucu toplamlarını basar: sevk BRÜT, iade ayrı kutu (düşülmez)", async () => {
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await shipmentsReady();
    await waitFor(() => expect(screen.getByTestId("summary-tile-shipped")).toHaveTextContent("1234,5 m"));
    expect(screen.getByTestId("summary-tile-returns")).toHaveTextContent("25 m");
    expect(screen.getByTestId("summary-tile-orders")).toHaveTextContent("7");
  });

  it("④ finans okuma kapısı kapalıyken tutar/bakiye yok ve cari isteği atılmaz", async () => {
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await shipmentsReady();
    await waitFor(() => expect(screen.getByTestId("summary-tile-orders")).toBeInTheDocument());
    expect(screen.queryByTestId("summary-tile-amount")).toBeNull();
    expect(screen.queryByTestId("summary-tile-balance")).toBeNull();
    expect(urls().some((x) => x.startsWith("/api/finance"))).toBe(false);
    expect(screen.queryByText(/98\.765/)).toBeNull();
  });

  it("⑤ finans okuma kapısı açıkken sipariş tutarı ve cari bakiye çizilir", async () => {
    financeRead = true;
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await waitFor(() => expect(screen.getByTestId("summary-tile-balance")).toHaveTextContent("5.000"));
    expect(screen.getByTestId("summary-tile-amount")).toHaveTextContent("98.765");
  });

  it("⑥ bir bölümün hatası diğerlerini düşürmez; yeniden dene çalışır", async () => {
    routes({ ret: new Error("500") });
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await shipmentsReady();
    await waitFor(() => expect(within(section("İadeler")).getByText("Yüklenemedi.")).toBeInTheDocument());
    expect(within(section("Son siparişler")).getByText("SIP-001")).toBeInTheDocument();
    routes();
    await userEvent.click(within(section("İadeler")).getByRole("button", { name: /Yeniden dene/ }));
    await waitFor(() => expect(within(section("İadeler")).getByText("IAD-1")).toBeInTheDocument());
  });

  it("⑦ boş küme 'Kayıt yok'; 'Tümünü gör' liste ekranını cari süzgeciyle yeni sekmede açar", async () => {
    routes({ ret: { success: true, data: [], summary: { count: 0, totalQty: 0 }, pagination: pg } });
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    await waitFor(() => expect(within(section("İadeler")).getByText("Kayıt yok")).toBeInTheDocument());
    await userEvent.click(within(section("Sevk edilenler")).getByRole("button", { name: "Tümünü gör" }));
    expect(openTab).toHaveBeenCalledWith(`/operations/shipments?filter[customerId]=${CID}&filter[status]=DISPATCHED`, { forceNew: true });
  });

  it("⑧ hiçbir okuma izni yoksa açıklama yazar, istek atmaz", () => {
    perms = [];
    routes();
    renderWithProviders(<CustomerSummaryTab customerId={CID} />);
    expect(screen.getByText(/okuma izni gerekir/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
