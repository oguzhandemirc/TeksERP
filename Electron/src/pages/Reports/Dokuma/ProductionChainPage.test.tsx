// =============================================================================
// BEKÇİ — Üretim Zinciri yaprağı (Z3): §1 satır dört belgeyi çizer, hücre → belge · §2 devere kapalı → Levent kolonu yok ·
//   §3 boş → "Açık sipariş satırı yok" · §4 uç hatası → hata kartı EN ÜSTTE · §5 bağsız sekmesi sayı + ad · §6 gecikmiş anahtarı → istek
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { ChainReport } from "./productionChain";

const get = vi.fn();
const opened: string[] = [];
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({ shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: true, dokumaEnabled: true, financeEnabled: false, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false, reportsClosedKeys: [], isReportOpen: () => true, flagsReady: true, flagsFailed: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }) }));
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: (to: string) => ({ onClick: () => opened.push(to), onAuxClick: () => {}, onContextMenu: () => {} }), useTabTarget: (to: string) => ({ onClick: () => opened.push(to) }) }));
vi.mock("./productionChain", async (orig) => ({ ...(await orig<typeof import("./productionChain")>()), productionChainApi: { get: (...a: unknown[]) => get(...a) } }));
import { ProductionChainPage } from "./ProductionChainPage";

const rapor = (devere: boolean, rows = 1): ChainReport => ({
  satirlar: rows ? [{ orderLineId: "l1", siparis: { id: "o1", no: "SIP-77", teslimTarihi: null }, musteri: { id: "c1", ad: "Müşteri A" }, kumas: { id: "i1", ad: "Poplin" }, renk: { id: "r1", ad: "Krem" }, siparisM: 300, sevkM: 50, isEmri: { id: "w1", no: "WO-9", durum: "IN_PROGRESS", adim: "KK1" }, dokuma: { id: "d1", no: "DK-5", durum: "IN_PROGRESS", dokunanM: 200, planM: 500, ilerlemePct: 40, planBitis: null }, ...(devere ? { levent: { id: "b1", no: "LV-3", durum: "MOUNTED", kalanM: 120 } } : {}), gecikmeGun: 4, durum: "GECIKMIS" }] : [],
  satirOmitted: 0,
  kovalar: { ...(devere ? { issizLevent: 2 } : {}), siparissizDokuma: 1, disaridanTop: 3 },
  ozet: { satir: rows, gecikmis: rows, bagsiz: devere ? 6 : 4 },
  moduller: { devere },
});
const zarf = (data: ChainReport) => ({ success: true, data, range: { from: "", to: "" }, meta: { secenekler: { customerId: [{ id: "c1", ad: "Müşteri A" }] } } });

beforeEach(() => { get.mockReset(); opened.length = 0; });

describe("ProductionChainPage", () => {
  it("§1 ⭐ satır dört belgeyi çizer (sipariş · iş emri + adım · dokuma %40 · levent kalan); hücre → belge yolu", async () => {
    get.mockResolvedValue(zarf(rapor(true)));
    const user = userEvent.setup();
    renderWithProviders(<ProductionChainPage />);
    const row = (await screen.findByText("SIP-77")).closest("tr")!;
    expect(row).toHaveTextContent("WO-9"); expect(row).toHaveTextContent("KK1"); expect(row).toHaveTextContent("DK-5"); expect(row).toHaveTextContent("40%"); expect(row).toHaveTextContent("LV-3"); expect(row).toHaveTextContent("kalan 120"); expect(row).toHaveTextContent("4 gün");
    expect(screen.getByRole("columnheader", { name: "Levent" })).toBeInTheDocument();
    await user.click(within(row).getByTitle("İş emrini aç"));
    await user.click(within(row).getByTitle("Leventi aç"));
    expect(opened).toEqual(["/operations/work-orders/w1", "/operations/warp-beams?search=LV-3"]);
  });

  it("§2 ⭐ devere kapalı → Levent kolonu ve levent kovası çizilmez", async () => {
    get.mockResolvedValue(zarf(rapor(false)));
    renderWithProviders(<ProductionChainPage />);
    await screen.findByText("SIP-77");
    expect(screen.queryByRole("columnheader", { name: "Levent" })).toBeNull();
    expect(screen.getByText("Bağsız kayıt").closest("div")!.parentElement).toHaveTextContent("Siparişsiz dokuma · dışarıdan top");
  });

  it("§3 veri yok → 'Açık sipariş satırı yok' (zincir kurulamadı değil)", async () => {
    get.mockResolvedValue(zarf(rapor(true, 0)));
    renderWithProviders(<ProductionChainPage />);
    expect(await screen.findByText("Açık sipariş satırı yok")).toBeInTheDocument();
  });

  it("§4 uç hata → hata kartı üstte, boş tablo 'iş yok' diye okunmaz", async () => {
    get.mockRejectedValue(new Error("boom"));
    renderWithProviders(<ProductionChainPage />);
    await waitFor(() => expect(screen.getByText(/yukarıdaki hata kartına bakın/)).toBeInTheDocument());
    expect(screen.queryByText("Açık sipariş satırı yok")).toBeNull();
  });

  it("§5 bağsız sekmesi: başlıkta sayı, adıyla üç kova, satır → liste", async () => {
    get.mockResolvedValue(zarf(rapor(true)));
    const user = userEvent.setup();
    renderWithProviders(<ProductionChainPage />);
    await screen.findByText("SIP-77");
    await user.click(screen.getByRole("tab", { name: /Bağsız kayıtlar \(6\)/ }));
    expect(await screen.findByText("İşsiz levent")).toBeInTheDocument();
    expect(screen.getByText("Siparişsiz dokuma")).toBeInTheDocument();
    await user.click(screen.getByText("Dışarıdan gelen top"));
    expect(opened).toContain("/operations/rolls");
  });

  it("§6 'Yalnız gecikmişler' → istek gecikmis=true; şerh satırı görünür", async () => {
    get.mockResolvedValue(zarf(rapor(true)));
    const user = userEvent.setup();
    renderWithProviders(<ProductionChainPage />);
    await screen.findByText("SIP-77");
    await user.click(screen.getByLabelText("Yalnız gecikmişler"));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ gecikmis: "true" })));
    expect(await screen.findByText("Yalnız gecikmiş satırlar")).toBeInTheDocument();
  });
});
