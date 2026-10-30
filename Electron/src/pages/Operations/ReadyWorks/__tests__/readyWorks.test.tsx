// D4-J3 Sevke Hazır İşler: sekme = groupBy, durum süzgeci query'de (sunucuda), gelen belge modülü kapalıyken iki
// sekme yok + istek yok, "sevke al" mevcut Hızlı Sevk diyaloğunu seçili HAZIR toplarla açar, İçerideki İşler hazırlık
// kolonu ready-works ucundan, bulunabilirlik (karo · palet).
import type { ReactNode } from "react";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { operationsTiles } from "@/pages/Operations/tile-config";
import { allCommandEntries } from "@/components/layout/command-entries";
import { ROUTE_MODULE } from "@/lib/route-modules";
import { ReadyWorksPage } from "../ReadyWorksPage";
import { ConsignedWorkPage } from "@/pages/Operations/ConsignedWork/ConsignedWorkPage";
import { readyWorksQueryString, type ReadyWorkPage, type ReadyWorkRoll, type ReadyWorkRow } from "../service";
import { readyWorksTabs, statesForFilter } from "../ready-works-view";

vi.mock("@/components/layout/PageHeader", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
vi.mock("@/components/RefreshButton", () => ({ RefreshButton: () => null }));
vi.mock("@/pages/Operations/Shipments/ShipmentDocDialog", () => ({ ShipmentDocDialog: () => null }));

const flags = { gelenBelge: true, finance: true };
vi.mock("@/hooks/usePricingEnabled", () => ({
  useGelenBelgeEnabled: () => flags.gelenBelge,
  useFeatureFlags: () => ({ data: { data: { financeEnabled: flags.finance } } }),
}));
const perms = { list: ["shipping:read", "shipping:write"] as string[] };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.list.includes(p) }),
}));

// Hızlı Sevk diyaloğu = MEVCUT boğaz; burada yalnız aldığı seçim ölçülür.
const quickShipProps = vi.fn();
vi.mock("@/pages/Operations/Rolls/QuickShipDialog", () => ({
  QuickShipDialog: (p: { initialRolls: Array<{ id: string }>; initialCustomerId: string | null }) => {
    quickShipProps(p);
    return <div data-testid="quick-ship">{p.initialRolls.map((r) => r.id).join(",")}</div>;
  },
}));

const getList = vi.fn();
const getRolls = vi.fn();
const getConsigned = vi.fn();
const getAll = vi.fn();
vi.mock("../service", async (orig) => ({
  ...(await orig<typeof import("../service")>()),
  getReadyWorks: (p: unknown) => getList(p),
  getReadyWorkRolls: (...a: unknown[]) => getRolls(...a),
  getAllReadyWorks: (u: string) => getAll(u),
}));
vi.mock("@/pages/Operations/ConsignedWork/service", async (orig) => ({
  ...(await orig<typeof import("@/pages/Operations/ConsignedWork/service")>()),
  getConsignedWork: () => getConsigned(),
}));

const row = (over: Partial<ReadyWorkRow> = {}): ReadyWorkRow => ({
  unit: "workOrder", id: "wo1", label: "İE-001", customerId: "c1", customerName: "Gül Perde", state: "READY",
  appliedRule: "ALL_DONE", readyCount: 2, readyMeters: 200, inProcessCount: 0, inProcessMeters: 0, shippedMeters: 0,
  scrapMeters: 0, targetMeters: null, ...over,
});
const page = (items: ReadyWorkRow[]): ReadyWorkPage => ({
  items, nextCursor: null,
  summary: { units: items.length, ready: items.length, partial: 0, none: 0, readyMeters: 200, inProcessMeters: 0, shippedMeters: 0 },
  policy: { rule: "ALL_DONE", tolerancePct: 0 },
});
const roll = (id: string, readinessClass: ReadyWorkRoll["readinessClass"]): ReadyWorkRoll => ({
  id, barcode: `B-${id}`, status: "WAREHOUSE", readinessClass, currentQty: 100, itemName: "Tül", colorName: null, ownerCustomerId: "c1",
});

beforeEach(() => {
  flags.gelenBelge = true;
  flags.finance = true;
  perms.list = ["shipping:read", "shipping:write"];
  getList.mockReset();
  getRolls.mockReset();
  getConsigned.mockReset();
  getAll.mockReset();
  quickShipProps.mockReset();
  getList.mockImplementation((p: { groupBy: string }) => Promise.resolve(page([row({ unit: p.groupBy as ReadyWorkRow["unit"] })])));
});

describe("Sevke Hazır İşler", () => {
  it("varsayılan: İş emri sekmesi + Hazır süzgeci SUNUCUYA gider (state=READY)", async () => {
    renderWithProviders(<ReadyWorksPage />);
    expect(await screen.findByText("İE-001")).toBeInTheDocument();
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ groupBy: "workOrder", states: ["READY"] }));
    expect(readyWorksQueryString({ groupBy: "workOrder", states: ["READY"] })).toBe("groupBy=workOrder&state=READY");
  });

  it("sekme değişimi doğru groupBy ile istek atar", async () => {
    renderWithProviders(<ReadyWorksPage />);
    await screen.findByText("İE-001");
    for (const [label, unit] of [["Gelen belge", "deliveryNote"], ["Parti", "customerBatch"], ["Müşteri", "customer"]] as const) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      await waitFor(() => expect(getList).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: unit })));
    }
  });

  it("durum süzgeci query'de: Kısmi → state=PARTIAL, Tümü → state yok; istemci satır elemez", async () => {
    // Sunucu süzgeci yok sayıp READY satırı dönse bile istemci onu GİZLEMEZ (süzme sunucuda).
    renderWithProviders(<ReadyWorksPage />);
    await screen.findByText("İE-001");
    fireEvent.click(screen.getByRole("button", { name: "Kısmi" }));
    await waitFor(() => expect(getList).toHaveBeenLastCalledWith(expect.objectContaining({ states: ["PARTIAL"] })));
    expect(await screen.findByText("İE-001")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tümü" }));
    await waitFor(() => expect(getList).toHaveBeenLastCalledWith(expect.objectContaining({ states: [] })));
    expect(statesForFilter("ALL")).toEqual([]);
    expect(readyWorksQueryString({ groupBy: "customer", states: [] })).toBe("groupBy=customer");
    expect(readyWorksQueryString({ groupBy: "customer", states: ["PARTIAL"], cursor: "x" })).toBe("groupBy=customer&state=PARTIAL&cursor=x");
  });

  it("gelen belge modülü kapalı → Gelen belge ve Parti sekmesi yok, o birimlere istek atılmaz", async () => {
    flags.gelenBelge = false;
    renderWithProviders(<ReadyWorksPage />);
    await screen.findByText("İE-001");
    expect(screen.queryByRole("tab", { name: "Gelen belge" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Parti" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Müşteri" }));
    await waitFor(() => expect(getList).toHaveBeenLastCalledWith(expect.objectContaining({ groupBy: "customer" })));
    const units = getList.mock.calls.map((c) => (c[0] as { groupBy: string }).groupBy);
    expect(units.some((u) => u === "deliveryNote" || u === "customerBatch")).toBe(false);
    expect(readyWorksTabs(false).map((t) => t.unit)).toEqual(["workOrder", "customer"]);
  });

  it("satır → toplar çekmecesi; 'sevke al' Hızlı Sevk'i yalnız seçili HAZIR toplar + birimin müşterisiyle açar", async () => {
    getRolls.mockResolvedValue([roll("r1", "READY"), roll("r2", "IN_PROCESS"), roll("r3", "READY")]);
    renderWithProviders(<ReadyWorksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "İE-001 toplarını aç" }));
    await screen.findByText("B-r3");
    expect(getRolls).toHaveBeenCalledWith("workOrder", "wo1");
    fireEvent.click(screen.getByRole("checkbox", { name: "B-r3 seç" }));
    fireEvent.click(screen.getByRole("button", { name: /Hazır topları sevke al \(1 top/ }));
    expect(await screen.findByTestId("quick-ship")).toHaveTextContent("r1");
    const last = quickShipProps.mock.calls.at(-1)?.[0] as { initialRolls: Array<{ id: string }>; initialCustomerId: string | null };
    expect(last.initialRolls.map((r) => r.id)).toEqual(["r1"]);
    expect(last.initialCustomerId).toBe("c1");
  });

});

describe("Sevke Hazır İşler — çekmece Hızlı Sevk ön-seçimi", () => {
  it("çuvaldaki / sevkiyattaki HAZIR top ön-seçili gelmez, seçilemez, rozetle ayrılır (Hızlı Sevk 400'ü önlenir)", async () => {
    getRolls.mockResolvedValue([roll("r1", "READY"), { ...roll("r2", "READY"), inSack: true }, { ...roll("r3", "READY"), inShipment: true }]);
    renderWithProviders(<ReadyWorksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "İE-001 toplarını aç" }));
    await screen.findByText("B-r3");
    expect(screen.getByRole("checkbox", { name: "B-r2 seç" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "B-r3 seç" })).toBeDisabled();
    expect(screen.getByText("Çuvalda")).toBeInTheDocument();
    expect(screen.getByText("Sevkiyatta")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hazır topları sevke al \(1 top/ }));
    const last = quickShipProps.mock.calls.at(-1)?.[0] as { initialRolls: Array<{ id: string }> };
    expect(last.initialRolls.map((r) => r.id)).toEqual(["r1"]);
  });

  it("iki depo: varsayılan seçim ana depoda; öteki depodan top eklenince uyarı + düğme kapalı", async () => {
    const at = (id: string, wh: string) => ({ ...roll(id, "READY"), warehouseId: wh, warehouseName: `Depo ${wh}` });
    getRolls.mockResolvedValue([at("r1", "A"), at("r2", "A"), at("r3", "B")]);
    renderWithProviders(<ReadyWorksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "İE-001 toplarını aç" }));
    await screen.findByText("B-r3");
    expect(screen.getByRole("checkbox", { name: "B-r3 seç" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Hazır topları sevke al \(2 top/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "B-r3 seç" }));
    expect(screen.getByText(/farklı depolarda/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hazır topları sevke al \(3 top/ })).toBeDisabled();
  });

});

describe("Sevke Hazır İşler — izin, yaratıcı, bulunabilirlik", () => {
  it("ticaret rejimi kapalı ya da sevk yazma izni yok → 'sevke al' yok", async () => {
    flags.finance = false;
    getRolls.mockResolvedValue([roll("r1", "READY")]);
    renderWithProviders(<ReadyWorksPage />);
    fireEvent.click(await screen.findByRole("button", { name: "İE-001 toplarını aç" }));
    await screen.findByText("B-r1");
    expect(screen.queryByRole("button", { name: /sevke al/ })).toBeNull();
    expect(screen.getByText(/Sevk Kapısı \/ çuval akışından/)).toBeInTheDocument();
  });

  it("ikinci sevkiyat yaratıcısı yok: ekran klasöründe POST çağrısı yok", () => {
    const dir = path.resolve(__dirname, "..");
    const src = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(src).not.toMatch(/apiClient\.(post|put|patch)|\.post\(/);
    expect(src).toMatch(/from "@\/pages\/Operations\/Rolls\/QuickShipDialog"/);
  });

  it("bulunabilir: Sevkiyat hub karosu (shipping:read) · palet · modül tablosunda değil (çekirdek)", () => {
    const tile = operationsTiles.find((t) => t.to === "/operations/sevke-hazir-isler");
    expect(tile?.group).toBe("shipping");
    expect(tile?.permission).toBe("shipping:read");
    expect(allCommandEntries.some((e) => e.to === "/operations/sevke-hazir-isler")).toBe(true);
    expect(ROUTE_MODULE["operations/sevke-hazir-isler" as keyof typeof ROUTE_MODULE]).toBeUndefined();
  });
});

describe("İçerideki İşler hazırlık kolonu", () => {
  const b = (count: number, qty: number) => ({ count, qty });
  const summary = {
    rows: [{ ownerCustomerId: "c1", ownerName: "Gül Perde", waiting: b(0, 0), waitingSemi: b(0, 0), inProcess: b(1, 50), ready: b(2, 200), other: b(0, 0), total: b(3, 250) }],
    totals: { waiting: b(0, 0), waitingSemi: b(0, 0), inProcess: b(1, 50), ready: b(2, 200), other: b(0, 0), total: b(3, 250) },
  };

  it("hazırlık ready-works?groupBy=customer ucundan gelir (ikinci hesap yok)", async () => {
    getConsigned.mockResolvedValue(summary);
    getAll.mockResolvedValue([row({ unit: "customer", id: "c1", label: "Gül Perde", state: "PARTIAL", readyMeters: 200 })]);
    renderWithProviders(<ConsignedWorkPage />);
    expect(await screen.findByText("Kısmi")).toBeInTheDocument();
    expect(screen.getByText(/200(,0)? m hazır/)).toBeInTheDocument();
    expect(getAll).toHaveBeenCalledWith("customer");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Hazırlık");
  });

  it("hazırlık hücresi Müşteri sekmesine bağlanır; uç hata verirse 'yüklenemedi' ('satır yok' ile karışmaz)", async () => {
    getConsigned.mockResolvedValue(summary);
    getAll.mockResolvedValue([row({ unit: "customer", id: "c1", label: "Gül Perde", state: "READY" })]);
    const first = renderWithProviders(<ConsignedWorkPage />);
    expect((await screen.findByText("Hazır")).closest("a")?.getAttribute("href")).toContain("?tab=customer");
    first.unmount();
    getAll.mockRejectedValue(new Error("500"));
    renderWithProviders(<ConsignedWorkPage />);
    expect(await screen.findByText("yüklenemedi")).toBeInTheDocument();
  });

  it("shipping:read yoksa kolon yok ve istek atılmaz", async () => {
    perms.list = [];
    getConsigned.mockResolvedValue(summary);
    renderWithProviders(<ConsignedWorkPage />);
    await screen.findByText("Gül Perde");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).not.toContain("Hazırlık");
    expect(getAll).not.toHaveBeenCalled();
  });
});
