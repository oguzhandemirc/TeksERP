// E2 bekçisi: sipariş satırı müşteri adı ("—"), durum sözlükten (ham enum yok), yazma izni/çevrimdışı düğme kapısı,
// süzgeç ve arama SUNUCUYA parametre olarak gider (istemci süzmez), sipariş ayrıntısı kendi rotasına açılır.
// P6: kalem listesi (`siparisId`), sipariş araması + görünüm çipleri, cari hareketleri (`cariHesapId`) YALNIZ sunucu
// `/oturum` `liste` yeteneğinde beyan ettiyse; eski sunucuda (alan yok) E2 görünümü kalır.
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
const CustomerDetail = (require("../app/(app)/cariler/[id]") as { default: () => ReactElement }).default;
const { listCapability } = require("../src/ui/siparis/capabilities") as typeof import("../src/ui/siparis/capabilities");
const { lineRowText, movementRowText } = require("../src/ui/siparis/OrderLines") as typeof import("../src/ui/siparis/OrderLines");
const { LIST_ID_FILTERS, LIST_SEARCH } = require("../src/api/wire") as typeof import("../src/api/wire");
const { orderStatus, deadlineBadge, ORDER_STATUS } = require("../src/lib/labels/siparis") as typeof import("../src/lib/labels/siparis");
const { cariLockView } = require("../src/lib/cari-lock") as typeof import("../src/lib/cari-lock");
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

/** Yeni sunucunun `/oturum` yanıtındaki liste yeteneği (eski sunucu alanı göndermez → `facility.liste` yok). */
const YENI_SUNUCU = { liste: { kimlikSuzgecleri: LIST_ID_FILTERS, aranabilir: Object.keys(LIST_SEARCH) } };

beforeEach(() => {
  mockSession.facility = null;
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

describe("§6 P6 sipariş kalemleri (sunucu `siparisId` süzgeci)", () => {
  const ORDER = rec(ID1, { siparisNo: "SP-7", durum: "APPROVED", kalemSayisi: 2 });

  it("yetenek varsa kalemler `siparisId` ile SUNUCUDAN; satır ürün + renk / miktar + birim; P5 alanı yoksa \"—\"", async () => {
    mockSession.facility = YENI_SUNUCU;
    mockParams = { id: ID1 };
    mockRecord.mockResolvedValue(ORDER);
    mockList.mockResolvedValue(page(
      rec("k1", { siparisId: ID1, urunAdi: "Penye Örme", renkId: "r1", renkAdi: "Lacivert", miktar: "1250.5", birim: "MT", acikMiktar: "250" }),
      rec("k2", { siparisId: ID1, renkId: "r2", miktar: "40", birim: "KG", iptalTarihi: "2026-10-01T00:00:00.000Z", acikMiktar: "40" }),
    ));
    render(<OrderDetail />);
    await settle();
    expect(mockList).toHaveBeenCalledWith("siparis-kalemi", expect.objectContaining({ siparisId: ID1 }));
    expect(screen.getByText("Penye Örme")).toBeTruthy();
    expect(screen.getByText("1.250,5 m")).toBeTruthy();
    expect(screen.getByText(/Renk Lacivert · .*Açık 250 m/)).toBeTruthy();
    expect(screen.getByTestId("kalem-k2").props.accessibilityLabel).toBe("—, İptal edildi · Renk —, 40 kg"); // P5 adları gelmemiş, iptal kalem: açık miktar yok
    expect(screen.queryByTestId("siparis-kalem-ozeti")).toBeNull();
  });

  it("eski sunucu (yetenek yok) → kalem listesi İSTENMEZ, fabrikanın kalem özeti kalır", async () => {
    mockParams = { id: ID1 };
    mockRecord.mockResolvedValue(ORDER);
    render(<OrderDetail />);
    await settle();
    expect(mockList).not.toHaveBeenCalledWith("siparis-kalemi", expect.anything());
    expect(screen.getByTestId("siparis-kalem-ozeti")).toBeTruthy();
  });

  it("satır metni: iptal kalemde açık miktar yok; renksiz kalemde renk yok, adı gelmemiş renkte \"—\"", () => {
    expect(lineRowText(rec("a", { urunAdi: "X", miktar: "5", birim: "ADET", iptalTarihi: "2026-01-01", acikMiktar: "5" }) as never).subtitle).toBe("İptal edildi");
    expect(lineRowText(rec("a", { urunAdi: "X", miktar: "5", birim: "MT", renkId: "r", sevkMiktari: "2" }) as never).subtitle).toBe("Renk — · Sevk 2 m");
    expect(lineRowText(rec("a", { miktar: "5", birim: "KG" }) as never)).toMatchObject({ title: "—", value: "5 kg" });
  });
});

describe("§7 P6 sipariş araması + görünüm çipleri", () => {
  it("yetenek varsa arama `ara`, çip `suzgec` olarak sunucuya gider; `durum` gönderilmez; Tümü süzgeci kaldırır", async () => {
    jest.useFakeTimers();
    try {
      mockSession.facility = YENI_SUNUCU;
      mockList.mockResolvedValue(page(rec(ID1, { siparisNo: "SP-1", durum: "COMPLETED", musteriAdi: "Sunucunun döndüğü" })));
      render(<Orders />);
      await settle();
      expect(screen.queryByTestId("suzgec-durum")).toBeNull();
      fireEvent.changeText(screen.getByTestId("siparis-ara"), " mavi ");
      await act(async () => { jest.advanceTimersByTime(350); });
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ ara: "mavi", suzgec: undefined, durum: undefined }));
      fireEvent.press(screen.getByTestId("cip-GECIKMIS"));
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ ara: "mavi", suzgec: "GECIKMIS" }));
      expect(screen.getByText("Sunucunun döndüğü")).toBeTruthy(); // istemci süzmez
      expect(screen.getByTestId("cip-GECIKMIS").props.accessibilityState).toEqual({ selected: true });
      fireEvent.press(screen.getByTestId("cip-tumu"));
      await settle();
      expect(mockList).toHaveBeenLastCalledWith("siparis", expect.objectContaining({ suzgec: undefined }));
    } finally {
      jest.useRealTimers();
    }
  });

  it("çipler sunucu beyanından; eski sunucuda arama yok, `durum` süzgeci kalır", async () => {
    mockSession.facility = YENI_SUNUCU;
    mockList.mockResolvedValue(page());
    const view = render(<Orders />);
    await settle();
    for (const o of LIST_SEARCH.siparis!.suzgec!.secenekler) expect(screen.getByTestId(`cip-${o.deger}`)).toBeTruthy();
    view.unmount();
    mockSession.facility = { liste: undefined };
    render(<Orders />);
    await settle();
    expect(screen.queryByTestId("siparis-ara")).toBeNull();
    expect(screen.getByTestId("suzgec-durum")).toBeTruthy();
  });

  it("yetenek okuması: eski sunucu (alan yok) her şeyi kapatır; beyansız çift kapalı", () => {
    const eski = listCapability({} as never);
    expect(eski.idFilter("siparis-kalemi", "siparisId")).toBe(false);
    expect(eski.search("siparis")).toBeNull();
    const yeni = listCapability(YENI_SUNUCU as never);
    expect(yeni.idFilter("siparis-kalemi", "siparisId")).toBe(true);
    expect(yeni.idFilter("siparis", "siparisId")).toBe(false);
    expect(yeni.search("siparis")?.alanlar).toContain("musteriAdi");
    expect(listCapability({ liste: { kimlikSuzgecleri: {}, aranabilir: ["bilinmeyen"] } } as never).search("bilinmeyen")).toBeNull();
  });
});

describe("§8 P6 cari hareketleri (sunucu `cariHesapId` süzgeci)", () => {
  const HESAP = "33333333-3333-4333-8333-333333333333";
  const byProjection = (p: string) => {
    if (p === "cari-hesap") return Promise.resolve(page(rec(HESAP, { tur: "CUSTOMER", cariKartId: ID1 }, { bakiyeler: [] })));
    if (p === "cari-hareket") return Promise.resolve(page(rec("h1", { cariHesapId: HESAP, kaynak: "INVOICE", tarih: "2026-10-20T08:00:00.000Z", doviz: "TRY" }, { borc: "1500", alacak: "0" })));
    return Promise.resolve(page());
  };

  beforeEach(() => {
    mockSession.permissions = [...mockSession.permissions, "bulut:cari-bakiye:oku"];
    mockParams = { id: ID1 };
    mockRecord.mockResolvedValue(rec(ID1, { ad: "Deniz Tekstil", kod: "C-1", musteriRolu: true }));
    mockList.mockImplementation(byProjection);
  });

  it("yetenek varsa her hesabın hareketleri `cariHesapId` ile; kaynak sözlükten, tutar finanstan", async () => {
    mockSession.facility = YENI_SUNUCU;
    render(<CustomerDetail />);
    await settle();
    await settle();
    expect(mockList).toHaveBeenCalledWith("cari-hareket", expect.objectContaining({ cariHesapId: HESAP }));
    expect(mockList).not.toHaveBeenCalledWith("cari-hareket", expect.objectContaining({ cariKartId: expect.anything() }));
    expect(screen.getByText("Son hareketler")).toBeTruthy();
    expect(screen.getByText("Fatura")).toBeTruthy();
    expect(screen.queryByText(/INVOICE/)).toBeNull();
  });

  it("eski sunucu → hareket İSTENMEZ, bölüm yok", async () => {
    render(<CustomerDetail />);
    await settle();
    await settle();
    expect(mockList).not.toHaveBeenCalledWith("cari-hareket", expect.anything());
    expect(screen.queryByText("Son hareketler")).toBeNull();
  });

  it("hareket satırı: sıfır olmayan taraf; finans yoksa tutar yok", () => {
    const a = movementRowText(rec("h", { kaynak: "PAYMENT", tarih: "2026-10-20T08:00:00.000Z", doviz: "USD" }, { borc: "0", alacak: "200" }) as never);
    expect(a.title).toBe("Tahsilat / Ödeme");
    expect(a.subtitle).toContain("Alacak");
    expect(a.value).toBe("200 $");
    expect(movementRowText(rec("h", { kaynak: "INVOICE", tarih: "2026-10-20T08:00:00.000Z" }) as never).value).toBeUndefined();
  });
});

describe("§9 D4-I6 cari kilidi rozeti (fabrika `cari-hesap.kilit`)", () => {
  const HESAP = "44444444-4444-4444-8444-444444444444";
  const KILIT = { durum: "AKTIF", kilitId: "k1", kapsam: ["SEVK", "FATURA"], sebepKodu: "BORC", baslangic: "2026-10-30T07:00:00.000Z", acilis: null };
  const withLock = (kayit: Record<string, unknown>) => (p: string) =>
    Promise.resolve(p === "cari-hesap" ? page(rec(HESAP, { tur: "CUSTOMER", cariKartId: ID1, ...kayit }, { bakiyeler: [] })) : page());

  beforeEach(() => {
    mockSession.permissions = [...mockSession.permissions, "bulut:cari-bakiye:oku"];
    mockParams = { id: ID1 };
    mockRecord.mockResolvedValue(rec(ID1, { ad: "Deniz Tekstil", kod: "C-1", musteriRolu: true }));
  });

  it("aktif kilit → Kilitli rozeti + kapsam/sebep/tarih fabrikadan, uygulama hesaplamaz", async () => {
    mockList.mockImplementation(withLock({ kilit: KILIT }));
    render(<CustomerDetail />);
    await settle();
    await settle();
    expect(screen.getByTestId(`cari-kilit-${HESAP}`)).toBeTruthy();
    expect(screen.getByTestId(`cari-kilit-ayrinti-${HESAP}`).props.children).toBe("Durdurulan: sevk · fatura onayı · Sebep: Borç · 30.10.2026 10:00 itibarıyla");
  });

  it("açılmış kilit ya da null → rozet yok; eski fabrika (alan yok) → 'güncellenince gelir'", async () => {
    mockList.mockImplementation(withLock({ kilit: { ...KILIT, durum: "ACILDI", acilis: "2026-10-30T09:00:00.000Z" } }));
    render(<CustomerDetail />);
    await settle();
    await settle();
    expect(screen.queryByTestId(`cari-kilit-${HESAP}`)).toBeNull();
    expect(screen.queryByTestId(`cari-kilit-bilinmiyor-${HESAP}`)).toBeNull();
    expect(cariLockView({ kilit: null })).toEqual({ state: "YOK" });
    expect(cariLockView({})).toEqual({ state: "BILINMIYOR", text: "Kilit bilgisi fabrika güncellenince gelir" });
  });

  it("eski fabrika satırı ekranda 'fabrika güncellenince gelir' yazar", async () => {
    mockList.mockImplementation(withLock({}));
    render(<CustomerDetail />);
    await settle();
    await settle();
    expect(screen.getByTestId(`cari-kilit-bilinmiyor-${HESAP}`)).toBeTruthy();
    expect(screen.queryByTestId(`cari-kilit-${HESAP}`)).toBeNull();
  });
});
