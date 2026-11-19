// Patron İE ekranı (D3) + fason firması (D4): §1 liste — üyelik yeteneği yoksa aşama çipi gizli, varsa aşama süzgeci
// sunucuya gider ve satır o aşamanın top sayısını yazar · §2 ayrıntı — aşama kırılımı, siparişsiz İE, fason firma "N gündür"
// · §3 fason firma ayrıntısı — müşteri/ürün kırılımı; eski fabrika (alan yok) notu · §4 görünüm saf okuyucular.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-19T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: ["bulut:uretim:oku", "bulut:cari:oku", "bulut:siparis:oku"], offline: false, offlineSince: null,
  facility: null as unknown, facilities: [], switchError: null, factoryStamp: "2026-11-19T08:55:00Z",
};
let mockParams: Record<string, string> = {};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), setParams: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const List = (require("../app/(app)/is-emirleri/index") as { default: () => React.ReactElement }).default;
const Detail = (require("../app/(app)/is-emirleri/[id]") as { default: () => React.ReactElement }).default;
const Firm = (require("../app/(app)/fason/[firmaId]") as { default: () => React.ReactElement }).default;
const ie = require("../src/lib/is-emri") as typeof import("../src/lib/is-emri");

const F1 = "22222222-2222-4222-8222-222222222222";
const C1 = "11111111-1111-4111-8111-111111111111";
const LISTE = { liste: { kimlikSuzgecleri: {}, aranabilir: ["is-emri"], uyelikSuzgecleri: { "is-emri": ["cariKartId", "siparisId", "fasonFirmaId", "asama"] } } };
const ON_GUN = new Date(Date.now() - 10 * 86_400_000).toISOString();
const IE = {
  isEmriNo: "IE-2026-0042", acik: true, durum: "IN_PROGRESS", tur: "ORDER_PRODUCTION", musteriAdi: "Ayşe Tekstil", musteriAdlari: ["Ayşe Tekstil"], cariKartIdleri: [C1],
  siparisIdleri: ["s1"], siparisNolari: ["SP-12"], urunAdi: "Patos", renkAdi: "Ekru", topSayisi: 18, metre: "2160.000",
  asamalar: ["fason", "kursun"], asamaTop: [{ anahtar: "fason", top: 10, metre: "1200.000" }, { anahtar: "kursun", top: 8, metre: "960.000" }, { anahtar: "depo", top: 0, metre: "0.000" }],
  fasonFirmaIdleri: [F1], fasonFirmalari: [{ fasonFirmaId: F1, ad: "Mavi Boya", top: 10, metre: "1200.000", enEskiGonderim: ON_GUN }],
};
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession.facility = null;
  mockApi.list.mockResolvedValue({ kayitlar: [{ id: "w1", kayit: IE }], sonraki: null });
  mockApi.record.mockResolvedValue({ id: "w1", kayit: IE });
});

describe("§1 liste", () => {
  it("eski sunucu (üyelik beyanı yok): aşama çipi ve arama gizli, parametre yok sayılır + not", async () => {
    mockParams = { asama: "kursun" };
    render(<List />);
    await flush();
    expect(screen.queryByTestId("is-emri-asama")).toBeNull();
    expect(screen.queryByTestId("is-emri-ara")).toBeNull();
    expect(screen.getByTestId("is-emri-suzgec-yok")).toBeTruthy();
    expect(mockApi.list.mock.calls[0]![1].uyelik?.asama).toBeUndefined();
  });
  it("beyanlı sunucu: konum süzgeci sunucuya gider, satır o aşamanın topunu yazar", async () => {
    mockSession.facility = LISTE;
    mockParams = { asama: "kursun" };
    render(<List />);
    await flush();
    expect(mockApi.list.mock.calls[0]![1]).toMatchObject({ suzgec: "ACIK", uyelik: { asama: "kursun" } });
    expect(screen.getByText("8 top")).toBeTruthy();
    fireEvent.press(screen.getByTestId("is-emri-w1"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/is-emirleri/[id]", params: { id: "w1" } });
  });
  it("firma konumu: fasonFirmaId gider, aşama gönderilmez, çip kaldırılabilir", async () => {
    mockSession.facility = LISTE;
    mockParams = { firma: F1, firmaAdi: "Mavi Boya" };
    render(<List />);
    await flush();
    expect(mockApi.list.mock.calls[0]![1].uyelik).toEqual({ fasonFirmaId: F1 });
    fireEvent.press(screen.getByTestId("is-emri-cip-firma"));
    expect(mockRouter.setParams).toHaveBeenCalledWith({ firma: undefined, firmaAdi: undefined });
  });
});

describe("§2 ayrıntı", () => {
  it("dört soru + aşama kırılımı (sıfır satır yok) + firma 'N gündür'", async () => {
    mockParams = { id: "w1" };
    render(<Detail />);
    await flush();
    expect(screen.getByText("Ayşe Tekstil")).toBeTruthy();
    expect(screen.getByText("SP-12")).toBeTruthy();
    expect(screen.getByText("Patos · Ekru")).toBeTruthy();
    expect(screen.getByTestId("is-emri-asama-fason")).toBeTruthy();
    expect(screen.queryByTestId("is-emri-asama-depo")).toBeNull();
    expect(screen.getByText(/10 gündür/)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`is-emri-firma-${F1}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/fason/[firmaId]", params: { firmaId: F1 } });
  });
  it("siparişsiz İE: 'Siparişsiz (stok)' ve 'Stok için üretim'", async () => {
    mockParams = { id: "w1" };
    mockApi.record.mockResolvedValue({ id: "w1", kayit: { ...IE, siparisIdleri: [], siparisNolari: [], musteriAdi: null, musteriAdlari: [], cariKartIdleri: [] } });
    render(<Detail />);
    await flush();
    expect(screen.getByTestId("is-emri-siparissiz")).toBeTruthy();
    expect(screen.getByText("Siparişsiz (stok)")).toBeTruthy();
    expect(screen.getByText("Stok için üretim")).toBeTruthy();
  });
});

describe("§3 fason firması", () => {
  const SNAP = (firma: Record<string, unknown>) => ({ projeksiyon: "fason-acik", veri: { acikSevk: 1, geciken: 0, yaklasan: 0, kalanMiktar: "1200.000", kirpildi: false, firmalar: [firma] }, olusturma: "2026-11-19T08:00:00Z" });
  const BASE = { fasonFirmaId: F1, etiket: "Mavi Boya", acikSevk: 1, geciken: 0, kalanMiktar: "1200.000", iplikKg: "0.000", leventAdet: 0 };
  it("kırılım: top, gün, müşteri ve ürün satırları; İE listesine firma süzgeciyle gider", async () => {
    mockSession.facility = LISTE;
    mockParams = { firmaId: F1 };
    mockApi.snapshot.mockResolvedValue(SNAP({ ...BASE, acikTop: 10, enEskiGonderim: ON_GUN, isEmriSayisi: 2,
      musteriler: [{ cariKartId: C1, ad: "Ayşe Tekstil", top: 7, metre: "840.000" }, { cariKartId: null, ad: null, top: 3, metre: "360.000" }],
      urunler: [{ urunId: "u1", urunAdi: "Patos", renkId: null, renkAdi: null, top: 10, metre: "1200.000" }] }));
    render(<Firm />);
    await flush();
    expect(screen.getByTestId("fason-firma-top")).toBeTruthy();
    expect(screen.getByText("10 gündür")).toBeTruthy();
    expect(screen.getByText("Müşterisi belirsiz (stok)")).toBeTruthy();
    expect(screen.getByText("Patos")).toBeTruthy();
    fireEvent.press(screen.getByTestId("fason-firma-is-emirleri"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/is-emirleri", params: { firma: F1, firmaAdi: "Mavi Boya" } });
  });
  it("eski fabrika (kırılım yok): kokpit sayıları + not, İE bağlantısı yok", async () => {
    mockSession.facility = LISTE;
    mockParams = { firmaId: F1 };
    mockApi.snapshot.mockResolvedValue(SNAP(BASE));
    render(<Firm />);
    await flush();
    expect(screen.getByTestId("fason-firma-eski")).toBeTruthy();
    expect(screen.queryByTestId("fason-firma-is-emirleri")).toBeNull();
  });
});

describe("§4 görünüm", () => {
  it("bilinmeyen alan '—', toplam fabrikadan, konum yoksa İE toplamı", () => {
    expect(ie.listRowText({}, null).title).toBe("—");
    expect(ie.listRowText(IE, null).value).toBe("18 top");
    expect(ie.orderCell({ ...IE, siparisNolari: ["A", "B", "C"], siparisIdleri: ["1", "2", "3"] })).toBe("A +2");
    expect(ie.whereText({ acik: false, durum: "COMPLETED" })).toBe("Tamamlandı");
  });
});
