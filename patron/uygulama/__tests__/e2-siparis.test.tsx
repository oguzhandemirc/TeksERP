// E2 bekçisi: sipariş satırı müşteri adı ("—"), durum sözlükten (ham enum yok), yazma izni/çevrimdışı düğme kapısı,
// süzgeç ve arama SUNUCUYA parametre olarak gider (istemci süzmez), sipariş ayrıntısı kendi rotasına açılır.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";

const mockList = jest.fn();
const mockRecord = jest.fn();
const mockSnapshot = jest.fn();
const mockCache = { load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "" })), peek: jest.fn(async () => null) };
const mockSession = {
  api: { list: mockList, record: mockRecord, snapshot: mockSnapshot },
  cache: mockCache, markOnline: jest.fn(),
  permissions: [] as string[], offline: false, offlineSince: null as string | null, facility: null as unknown, switchError: null as string | null,
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
// `useFocusEffect` yok → odak kancası etkisiz (ekran her an odakta).
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/siparisler", useLocalSearchParams: () => mockParams }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const Orders = (require("../app/(app)/(tabs)/siparisler/index") as { default: () => ReactElement }).default;
const OrderDetail = (require("../app/(app)/(tabs)/siparisler/[id]") as { default: () => ReactElement }).default;
const Customers = (require("../app/(app)/cariler/index") as { default: () => ReactElement }).default;
const { orderStatus, deadlineBadge, ORDER_STATUS } = require("../src/lib/labels/siparis") as typeof import("../src/lib/labels/siparis");
const { orderRowText } = require("../src/ui/siparis/OrderRow") as typeof import("../src/ui/siparis/OrderRow");
const { openRecord } = require("../src/ui/nav") as typeof import("../src/ui/nav");

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const rec = (id: string, kayit: Record<string, unknown>, finans?: Record<string, unknown>) => ({ id, kayit, ...(finans ? { finans } : {}), surum: "2026-10-22T09:00:00.000Z" });
const page = (...kayitlar: unknown[]) => ({ kayitlar, sonraki: null });

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}

beforeEach(() => {
  mockList.mockReset();
  mockRecord.mockReset();
  mockSnapshot.mockReset();
  mockRouter.push.mockReset();
  mockSession.permissions = ["bulut:oturum", "bulut:siparis:oku", "bulut:cari:oku"];
  mockSession.offline = false;
  mockSnapshot.mockResolvedValue({ projeksiyon: "ozet.siparis", veri: { acikKalem: 4, acikMiktar: "1250.5", gecikenKalem: 1, gecikenMiktar: "300", karsilanmaYuzde: 62.5 }, surum: "x" });
});

describe("§1 sipariş satırı", () => {
  it("müşteri adı yoksa \"—\"; varsa ad + sipariş no", async () => {
    mockList.mockResolvedValue(page(
      rec(ID1, { siparisNo: "SP-0001", durum: "APPROVED" }),
      rec(ID2, { siparisNo: "SP-0002", durum: "APPROVED", musteriAdi: "Deniz Tekstil" }),
    ));
    render(<Orders />);
    await settle();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Deniz Tekstil")).toBeTruthy();
    expect(screen.getByText(/SP-0002 · Onaylandı/)).toBeTruthy();
  });

  it("açık miktar fabrikadan, birimli; tutar yalnız finans alt satırı geldiyse para birimiyle", () => {
    const a = orderRowText(rec(ID1, { siparisNo: "SP-1", durum: "PARTIAL_SHIPPED", acikMiktar: "1250.5", doviz: "USD", termin: "2026-11-01" }, { tutar: "1000" }) as never);
    expect(a.open).toBe("1.250,5 m");
    expect(a.subtitle).toContain("1.000 $");
    const b = orderRowText(rec(ID1, { siparisNo: "SP-1", durum: "COMPLETED", acikMiktar: "0", doviz: "USD" }) as never);
    expect(b.open).toBeNull(); // kapanmış siparişte açık miktar yok
    expect(b.subtitle).not.toContain("$"); // finans alt satırı yok → tutar yok
  });
});

describe("§2 durum ve termin rozeti sözlükten", () => {
  it("her OrderStatus Türkçe; bilinmeyen değer ham döner", () => {
    for (const k of Object.keys(ORDER_STATUS)) expect(orderStatus(k).label).not.toBe(k);
    expect(orderStatus("PARTIAL_SHIPPED")).toEqual({ label: "Kısmi sevk", tone: "bilgi" });
    expect(orderStatus("YENI_DURUM").label).toBe("YENI_DURUM");
  });

  it("ekranda ham enum yok: PARTIAL_SHIPPED → Kısmi sevk", async () => {
    mockList.mockResolvedValue(page(rec(ID1, { siparisNo: "SP-9", durum: "PARTIAL_SHIPPED", musteriAdi: "A" })));
    render(<Orders />);
    await settle();
    expect(screen.queryByText(/PARTIAL_SHIPPED/)).toBeNull();
    expect(screen.getByText(/Kısmi sevk/)).toBeTruthy();
  });

  it("termin rozeti yalnız fabrikanın `gecikmis` alanından", () => {
    expect(deadlineBadge({ gecikmis: true, durum: "APPROVED", termin: "2026-01-01" })).toEqual({ label: "Gecikti", tone: "kritik" });
    expect(deadlineBadge({ gecikmis: false, durum: "APPROVED", termin: "2026-01-01" })).toEqual({ label: "Zamanında", tone: "iyi" });
    // Termin geçmiş görünse bile fabrika "gecikmedi" diyorsa uygulama tarih karşılaştırmaz.
    expect(deadlineBadge({ gecikmis: false, durum: "APPROVED", termin: "2000-01-01" })?.tone).toBe("iyi");
    expect(deadlineBadge({ gecikmis: false, durum: "COMPLETED", termin: "2026-01-01" })).toBeNull();
    expect(deadlineBadge({ durum: "APPROVED", termin: "2026-01-01" })).toBeNull(); // alan yok → rozet yok
  });
});

describe("§3 yazma kapısı", () => {
  beforeEach(() => mockList.mockResolvedValue(page()));

  it("bulut:siparis:yaz yoksa \"Yeni sipariş\" düğmesi yok", async () => {
    render(<Orders />);
    await settle();
    expect(screen.queryByTestId("yeni-siparis")).toBeNull();
    expect(screen.getByText("Henüz sipariş yok")).toBeTruthy();
  });

  it("izin varken çevrimiçi açık, çevrimdışı bantta kapalı", async () => {
    mockSession.permissions = [...mockSession.permissions, "bulut:siparis:yaz"];
    const a = render(<Orders />);
    await settle();
    expect(screen.getByTestId("yeni-siparis").props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
    fireEvent.press(screen.getByTestId("yeni-siparis"));
    expect(mockRouter.push).toHaveBeenCalledWith("/siparisler/yeni");
    a.unmount();
    mockSession.offline = true;
    mockSession.offlineSince = new Date().toISOString();
    render(<Orders />);
    await settle();
    expect(screen.getByTestId("bant-cevrimdisi")).toBeTruthy();
    expect(screen.getByTestId("yeni-siparis").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
});

describe("§4 süzgeç ve arama SUNUCUDA", () => {
  it("durum çipi sunucuya `durum` gönderir; dönen satır istemcide süzülmez", async () => {
    mockList.mockResolvedValue(page(rec(ID1, { siparisNo: "SP-1", durum: "COMPLETED", musteriAdi: "Sunucunun döndüğü" })));
    render(<Orders />);
    await settle();
    expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ durum: undefined, imlec: undefined }));
    fireEvent.press(screen.getByTestId("suzgec-durum"));
    fireEvent.press(screen.getByTestId("durum-PARTIAL_SHIPPED"));
    await settle();
    expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ durum: "PARTIAL_SHIPPED" }));
    expect(screen.getByText("Sunucunun döndüğü")).toBeTruthy(); // COMPLETED satır yine görünür: süzme sunucunun işi
    expect(screen.getByText("Durum: Kısmi sevk")).toBeTruthy();
    fireEvent.press(screen.getByTestId("suzgec-durum"));
    fireEvent.press(screen.getByTestId("durum-tumu"));
    await settle();
    expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ durum: undefined }));
  });

  it("özet şeridi fabrika anlığından (ozet:oku izniyle), sayı birimli", async () => {
    mockSession.permissions = [...mockSession.permissions, "bulut:ozet:oku"];
    mockList.mockResolvedValue(page());
    render(<Orders />);
    await settle();
    expect(mockSnapshot).toHaveBeenCalledWith("ozet.siparis");
    expect(screen.getByTestId("ozet-geciken").props.accessibilityLabel).toContain("1");
    expect(screen.getByText("1.251")).toBeTruthy(); // 1250.5 m → tam sayı biçimi (yuvarlamayı biçimleyici yapar)
  });

  it("cariler: arama `ara`, rol çipi `suzgec` olarak sunucuya gider; Tümü süzgeci kaldırır", async () => {
    jest.useFakeTimers();
    try {
      mockList.mockResolvedValue(page(rec(ID1, { ad: "Deniz Tekstil", kod: "C-1", musteriRolu: true, fasonRolu: true })));
      render(<Customers />);
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ ara: undefined, suzgec: undefined }));
      expect(screen.getByText("Müşteri")).toBeTruthy();
      expect(screen.getByText("Fason")).toBeTruthy();
      fireEvent.changeText(screen.getByTestId("cari-ara"), " deniz ");
      await act(async () => { jest.advanceTimersByTime(350); });
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ ara: "deniz" }));
      fireEvent.press(screen.getByTestId("suzgec-rol"));
      fireEvent.press(screen.getByTestId("rol-TEDARIKCI"));
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ ara: "deniz", suzgec: "TEDARIKCI" }));
      fireEvent.press(screen.getByTestId("suzgec-rol"));
      fireEvent.press(screen.getByTestId("rol-tumu"));
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("cari-kart", expect.objectContaining({ suzgec: undefined }));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("§5 sipariş ayrıntısı", () => {
  it("openRecord yalnız siparişi kendi rotasına yönlendirir; diğerleri jenerik kayıt", () => {
    const router = { push: jest.fn() };
    openRecord(router as never, "siparis", ID1);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/siparisler/[id]", params: { id: ID1 } });
    openRecord(router as never, "sevkiyat", ID2);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: "/kayit/[projeksiyon]/[id]", params: { projeksiyon: "sevkiyat", id: ID2 } });
  });

  it("başlık kartı: müşteri yoksa \"—\", durum ve yön sözlükten, tutar finans geldiyse", async () => {
    mockParams = { id: ID1 };
    mockRecord.mockResolvedValue(rec(ID1, { siparisNo: "SP-7", durum: "PENDING", yon: "EXPORT", doviz: "EUR", gecikmis: true, termin: "2026-10-01", acikMiktar: "40", kalemSayisi: 2 }, { tutar: "2500" }));
    render(<OrderDetail />);
    await settle();
    expect(mockRecord).toHaveBeenCalledWith("siparis", ID1);
    expect(screen.getByTestId("siparis-musteri").props.children).toBe("—");
    expect(screen.getByText("Beklemede")).toBeTruthy();
    expect(screen.getByText("Gecikti")).toBeTruthy();
    expect(screen.getByText("İhracat")).toBeTruthy();
    expect(screen.getByTestId("siparis-tutar").props.children).toBe("2.500 €");
    expect(screen.queryByText(/PENDING|EXPORT/)).toBeNull();
  });
});
