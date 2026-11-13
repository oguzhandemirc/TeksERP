// V5b bekçisi — patron uygulamasında istek üzerine rapor (ERP kipi): §1 yetenek `patronReportApi`ten (yoksa gizli) ·
// §2 `Raporcu` ERP uçları; bulut `Raporcu`su ağa gitmez, bulut `Api` değişmez · §3 liste "Son: …"/"Henüz oluşturulmadı",
// bulut kodu süzgeci UYGULANMAZ · §4 son sonuç + "Yeni oluştur" (son parametreler) · §5 çift dokunuş tek istek, belirsiz
// hatada aynı kimlik · §6 hata iletileri, izin hatasında katalog tazelenir · §7 çevrimdışı · §8 geçmiş + iki adımlı silme ·
// §9 bulut kipi eski akışta kalır.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";
import type { RaporSunumu } from "../src/api/wire";

const mockApi = { snapshot: jest.fn(), reportList: jest.fn(), reportGet: jest.fn(), reportCancel: jest.fn(), reportCreate: jest.fn() };
const mockRaporcu = { katalog: jest.fn(), olustur: jest.fn(), gecmis: jest.fn(), kosum: jest.fn(), sil: jest.fn() };
const mockCacheState = { offline: false };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: mockCacheState.offline, savedAt: "2026-11-12T11:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, raporcu: mockRaporcu, cache: mockCache, markOnline: jest.fn(), permissions: ["bulut:rapor:oku"] as string[], offline: false,
  offlineSince: null, facility: null, facilities: [], switchError: null, factoryStamp: null,
};
const mockParams: { value: Record<string, string> } = { value: {} };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/raporlar",
  useLocalSearchParams: () => mockParams.value,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const access = require("../src/lib/access") as typeof import("../src/lib/access");
const rapor = require("../src/api/rapor") as typeof import("../src/api/rapor");
const { createApi } = require("../src/api/endpoints") as typeof import("../src/api/endpoints");
const { createErpApi } = require("../src/api/erp") as typeof import("../src/api/erp");
const metin = require("../src/lib/rapor-anlik") as typeof import("../src/lib/rapor-anlik");
const Reports = (require("../app/(app)/raporlar/index") as { default: () => React.ReactElement }).default;
const ReportDetail = (require("../app/(app)/raporlar/[id]") as { default: () => React.ReactElement }).default;
const RaporEkrani = (require("../app/(app)/raporlar/rapor") as { default: () => React.ReactElement }).default;
const Gecmis = (require("../app/(app)/raporlar/gecmis") as { default: () => React.ReactElement }).default;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ERP_PERMS = ["report:sales", "patron-app:login"];

async function flush() {
  for (let i = 0; i < 4; i++) await act(async () => undefined);
}

function sunum(): RaporSunumu {
  return {
    anahtar: "sales/sevkiyat", baslik: "Ne sevk ettik?", soru: "Kime kaç metre?",
    donem: { from: "2026-10-31T21:00:00.000Z", to: "2026-11-12T20:59:59.999Z", etiket: "Kasım 2026" },
    kiyasDonemi: null,
    anaSayi: { olcu: "sevk.metre", ad: "Sevk edilen metre", deger: 4200, birim: "m" },
    yanSayilar: [], anlati: [], grafik: null, tablo: null, tanimlar: [], parametreler: [], uyarilar: [],
  } as unknown as RaporSunumu;
}

function kosum(n: number, over: Record<string, unknown> = {}) {
  return {
    id: U(n), raporAnahtari: "sales/sevkiyat", aile: "sales", baslik: "Sevkiyat", parametreler: { dateFrom: "2026-11-01", dateTo: "2026-11-12" },
    parametreOzeti: "01.11.2026 – 12.11.2026", durum: "HAZIR", hataKodu: null, olusturulma: "2026-11-12T11:05:00.000Z",
    tamamlanma: "2026-11-12T11:05:03.000Z", sureMs: 3200, olusturan: { id: U(99), kullaniciAdi: "patron" },
    sonuc: { veri: sunum(), hesaplandi: "2026-11-12T11:05:03.000Z", kaynakUfuk: null },
    ...over,
  };
}

const KATALOG = {
  raporlar: [
    { anahtar: "sales/sevkiyat", baslik: "Sevkiyat", aile: "sales", parametreler: ["dateFrom", "dateTo"], sonKosum: kosum(1) },
    // Bulut kodu eşlemesinde (`REPORT_KEY_PERMISSION`) OLMAYAN anahtar: ERP'de sunucu süzdüğü için yine görünür.
    { anahtar: "yeni/erp-raporu", baslik: "Yeni ERP raporu", aile: "yeni", parametreler: [], sonKosum: null },
  ],
};

beforeEach(() => {
  for (const f of [...Object.values(mockApi), ...Object.values(mockRaporcu), mockRouter.push, mockRouter.back]) f.mockReset();
  mockCache.load.mockClear();
  mockRaporcu.katalog.mockResolvedValue(KATALOG);
  mockRaporcu.kosum.mockImplementation(async (id: string) => kosum(Number(id.slice(-12))));
  mockSession.offline = false;
  mockCacheState.offline = false;
  mockParams.value = {};
  yet.setYetenek(yet.erpYetenek(["siparis"], ERP_PERMS, 1));
});

afterAll(() => yet.setYetenek(yet.BULUT_YETENEK));

describe("§1 yetenek", () => {
  it("patronReportApi yoksa rapor gizli; varsa raporlar modülü görünür ve izin süzgeci bulut:rapor:oku'yu korur", () => {
    const eski = yet.erpYetenek(["siparis"], ERP_PERMS);
    expect(eski.rapor).toBe(false);
    expect(eski.raporAnlik).toBe(false);
    expect(access.moduleVisible(yet.izinleriSuz(["bulut:rapor:oku"], eski), "raporlar")).toBe(false);
    const yeni = yet.erpYetenek(["siparis"], ERP_PERMS, 1);
    expect(yeni.rapor && yeni.raporAnlik).toBe(true);
    expect(yet.izinleriSuz(["bulut:rapor:oku"], yeni)).toEqual(["bulut:rapor:oku"]);
    expect(access.moduleVisible(["bulut:rapor:oku"], "raporlar")).toBe(true);
    // Beyan sayı değilse fail-closed.
    expect(yet.erpYetenek([], [], "1").rapor).toBe(false);
    expect(yet.BULUT_YETENEK.raporAnlik).toBe(false);
  });
});

describe("§2 rapor katmanı", () => {
  it("ERP Raporcu doğru yol, gövde, sorgu ve uzun zaman aşımıyla çağırır", async () => {
    const calls: unknown[][] = [];
    const c = {
      get: async (...a: unknown[]) => (calls.push(["GET", ...a]), {}),
      post: async (...a: unknown[]) => (calls.push(["POST", ...a]), {}),
      patch: async () => ({}),
      del: async (...a: unknown[]) => (calls.push(["DELETE", ...a]), {}),
      download: async () => { throw new Error("yok"); },
    } as unknown as import("../src/api/client").ApiClient;
    const r = rapor.createErpRaporcu(c);
    await r.katalog();
    await r.olustur(U(5), "sales/sevkiyat", { dateFrom: "2026-11-01" });
    await r.gecmis("sales/sevkiyat", { limit: 50 });
    await r.kosum(U(1));
    await r.sil(U(1));
    expect(calls).toEqual([
      ["GET", "/patron/v1/raporlar/katalog"],
      ["POST", "/patron/v1/raporlar", { clientToken: U(5), raporAnahtari: "sales/sevkiyat", parametreler: { dateFrom: "2026-11-01" } }, { timeoutMs: rapor.RAPOR_OLUSTUR_TIMEOUT_MS }],
      ["GET", "/patron/v1/raporlar", { raporAnahtari: "sales/sevkiyat", imlec: undefined, limit: 50 }],
      ["GET", `/patron/v1/raporlar/${U(1)}`],
      ["DELETE", `/patron/v1/raporlar/${U(1)}`],
    ]);
    expect(rapor.RAPOR_OLUSTUR_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it("bulut Raporcu ağa gitmeden 404; bulut Api yeni yöntem almaz, ERP Api bulut rapor yöntemlerini yine reddeder", async () => {
    const b = rapor.createBulutRaporcu();
    await expect(b.katalog()).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(b.olustur(U(1), "x", {})).rejects.toMatchObject({ status: 404 });
    const net = jest.fn();
    const c = { get: net, post: net, patch: net, del: net, download: net } as unknown as import("../src/api/client").ApiClient;
    const keys = Object.keys(createApi(c));
    expect(keys.filter((k) => k.startsWith("report"))).toEqual(["reportCreate", "reportList", "reportGet", "reportCancel"]);
    const erp = createErpApi(c, () => yet.erpYetenek([], [], 1));
    await expect(erp.reportCreate(U(1), "sales/sevkiyat", {})).rejects.toMatchObject({ code: "KIP_DESTEKLEMIYOR" });
    expect(net).not.toHaveBeenCalled();
  });
});

describe("§3 liste", () => {
  it("her satırda ad + 'Son: GG.AA SS:DD' (fabrika saati) ya da 'Henüz oluşturulmadı'; bulut kodu süzgeci yok", async () => {
    render(<Reports />);
    await flush();
    expect(mockApi.snapshot).not.toHaveBeenCalled();
    expect(screen.getByText("Sevkiyat")).toBeTruthy();
    expect(screen.getByText("Son: 12.11 14:05")).toBeTruthy();
    expect(screen.getByText("Yeni ERP raporu")).toBeTruthy();
    expect(screen.getByText("Henüz oluşturulmadı")).toBeTruthy();
    fireEvent.press(screen.getByTestId("rapor-satir-sales/sevkiyat"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/raporlar/rapor", params: { anahtar: "sales/sevkiyat" } });
  });

  it("metin yardımcıları: süre ve özet", () => {
    expect(metin.sonMetni(null)).toBe("Henüz oluşturulmadı");
    expect(metin.sureMetni(400)).toBe("<1 sn");
    expect(metin.sureMetni(3200)).toBe("3 sn");
    expect(metin.sureMetni(65_000)).toBe("1 dk 5 sn");
    expect(metin.sureMetni(null)).toBe("");
    expect(metin.ozetMetni({ parametreOzeti: undefined })).toBe("Varsayılan dönem");
  });
});

describe("§4 rapor ekranı", () => {
  it("açılınca son koşumun saklı sonucu + üst satır; Yeni oluştur son parametrelerle oluşturur ve sonucu gösterir", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    mockRaporcu.olustur.mockResolvedValue(kosum(2, { olusturulma: "2026-11-13T07:30:00.000Z", parametreOzeti: "01.11.2026 – 13.11.2026" }));
    render(<RaporEkrani />);
    await flush();
    expect(mockRaporcu.kosum).toHaveBeenCalledWith(U(1));
    expect(screen.getByTestId("kosum-ust").props.children).toBe("Oluşturuldu: 12.11.2026 14:05 · 01.11.2026 – 12.11.2026");
    expect(screen.getByTestId("sunum-ana-deger")).toBeTruthy();
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    expect(screen.getByTestId("rapor-baslangic").props.value).toBe("01.11.2026");
    expect(screen.getByTestId("rapor-bitis").props.value).toBe("12.11.2026");
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(mockRaporcu.olustur).toHaveBeenCalledTimes(1);
    const [token, key, params] = mockRaporcu.olustur.mock.calls[0]!;
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(key).toBe("sales/sevkiyat");
    expect(params).toEqual({ dateFrom: "2026-11-01", dateTo: "2026-11-12" });
    expect(screen.getByTestId("kosum-ust").props.children).toBe("Oluşturuldu: 13.11.2026 10:30 · 01.11.2026 – 13.11.2026");
    expect(mockCache.load).toHaveBeenCalledWith(`rapor-anlik:kosum:${U(2)}`, expect.any(Function));
    expect(screen.queryByTestId("rapor-form")).toBeNull();
  });

  it("hiç oluşturulmamış raporda boş durum, saklı koşum istenmez", async () => {
    mockParams.value = { anahtar: "yeni/erp-raporu" };
    render(<RaporEkrani />);
    await flush();
    expect(mockRaporcu.kosum).not.toHaveBeenCalled();
    expect(screen.getByTestId("rapor-bos")).toBeTruthy();
  });
});

describe("§5 deneme kimliği", () => {
  it("hazırlanırken bekleme durumu; çift dokunuş tek istek; belirsiz hatada Tekrar dene aynı kimlikle", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    let fail!: (e: unknown) => void;
    mockRaporcu.olustur.mockImplementationOnce(() => new Promise((_res, rej) => (fail = rej)));
    render(<RaporEkrani />);
    await flush();
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(screen.getByTestId("rapor-hazirlaniyor")).toBeTruthy();
    expect(mockRaporcu.olustur).toHaveBeenCalledTimes(1);
    await act(async () => fail(new ApiError(0, "AG_HATASI", "x")));
    await flush();
    expect(screen.getByText("Sunucuya ulaşılamıyor.")).toBeTruthy();
    mockRaporcu.olustur.mockResolvedValueOnce(kosum(3));
    fireEvent.press(screen.getByTestId("rapor-tekrar"));
    await flush();
    expect(mockRaporcu.olustur).toHaveBeenCalledTimes(2);
    expect(mockRaporcu.olustur.mock.calls[1]![0]).toBe(mockRaporcu.olustur.mock.calls[0]![0]);
  });

  it("kesin 4xx (429) kimliği düşürür: sonraki deneme yeni kimlik", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    mockRaporcu.olustur.mockRejectedValueOnce(new ApiError(429, "RAPOR_SIRADA", "x")).mockResolvedValueOnce(kosum(4));
    render(<RaporEkrani />);
    await flush();
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(screen.getByText("Başka bir rapor hazırlanıyor, bitince tekrar deneyin.")).toBeTruthy();
    expect(screen.queryByTestId("rapor-tekrar")).toBeNull();
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(mockRaporcu.olustur.mock.calls[1]![0]).not.toBe(mockRaporcu.olustur.mock.calls[0]![0]);
  });
});

describe("§6 hata iletileri", () => {
  it.each([
    ["RAPOR_TAVAN", 429, "Saatlik rapor sınırına ulaşıldı."],
    ["PARAMETRE_GECERSIZ", 400, "Seçilen dönem bu rapor için geçerli değil."],
  ])("%s → kısa Türkçe", (code, status, text) => {
    expect(metin.raporHataIletisi(new ApiError(status, code, "sunucu metni"))).toBe(text);
  });

  it("koşum içi hata kodları", () => {
    expect(metin.kosumHataIletisi("ZAMAN_ASIMI")).toBe("Rapor 60 saniyede hazırlanamadı; aralığı daraltıp tekrar deneyin.");
    expect(metin.kosumHataIletisi("SONUC_BUYUK")).toBe("Sonuç çok büyük; aralığı daraltın.");
    expect(metin.kosumHataIletisi("BILINMEYEN")).toBe("Rapor hazırlanamadı; yeniden oluşturun.");
  });

  it("HATA'lı koşum nedenini gösterir; izin hatasında katalog yeniden çekilir", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    mockRaporcu.olustur.mockResolvedValueOnce(kosum(5, { durum: "HATA", hataKodu: "ZAMAN_ASIMI", sonuc: null }));
    render(<RaporEkrani />);
    await flush();
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(screen.getByText("Rapor 60 saniyede hazırlanamadı; aralığı daraltıp tekrar deneyin.")).toBeTruthy();
    const before = mockRaporcu.katalog.mock.calls.length;
    mockRaporcu.olustur.mockRejectedValueOnce(new ApiError(403, "RAPOR_IZNI_YOK", "x"));
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    fireEvent.press(screen.getByTestId("rapor-olustur"));
    await flush();
    expect(screen.getByText("Bu rapor için yetkiniz yok.")).toBeTruthy();
    expect(mockRaporcu.katalog.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("§7 çevrimdışı", () => {
  it("saklı sonuç görünür; Yeni oluştur pasif + 'Sunucuya ulaşılamıyor'", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    mockSession.offline = true;
    mockCacheState.offline = true;
    render(<RaporEkrani />);
    await flush();
    expect(screen.getByTestId("kosum-ust")).toBeTruthy();
    expect(screen.getByText("Sunucuya ulaşılamıyor")).toBeTruthy();
    expect(screen.getByTestId("rapor-yeni").props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(screen.getByTestId("rapor-yeni"));
    expect(screen.queryByTestId("rapor-form")).toBeNull();
    expect(mockRaporcu.olustur).not.toHaveBeenCalled();
  });
});

describe("§8 oluşturulanlar + silme", () => {
  it("geçmiş: tarih, özet + süre, durum; dokununca koşum ekranı", async () => {
    mockParams.value = { anahtar: "sales/sevkiyat" };
    mockRaporcu.gecmis.mockResolvedValue({ kayitlar: [kosum(1), kosum(6, { durum: "HATA", hataKodu: "ZAMAN_ASIMI", sureMs: 60_000, olusturulma: "2026-11-11T06:00:00.000Z" })], sonraki: null });
    render(<Gecmis />);
    await flush();
    expect(mockRaporcu.gecmis).toHaveBeenCalledWith("sales/sevkiyat", { limit: 50 });
    expect(screen.getByText("12.11.2026 14:05")).toBeTruthy();
    expect(screen.getByText("01.11.2026 – 12.11.2026 · 3 sn")).toBeTruthy();
    expect(screen.getByText("01.11.2026 – 12.11.2026 · 1 dk")).toBeTruthy();
    expect(screen.getByTestId(`kosum-durum-${U(6)}`)).toBeTruthy();
    fireEvent.press(screen.getByTestId(`kosum-${U(6)}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/raporlar/[id]", params: { id: U(6) } });
  });

  it("koşum ekranı sonucu gösterir; Sil iki adımlı → DELETE + geri", async () => {
    mockParams.value = { id: U(1) };
    mockRaporcu.sil.mockResolvedValue({ id: U(1), silindi: true });
    render(<ReportDetail />);
    await flush();
    expect(mockApi.reportGet).not.toHaveBeenCalled();
    expect(screen.getByTestId("kosum-ust")).toBeTruthy();
    fireEvent.press(screen.getByTestId("kosum-sil"));
    expect(mockRaporcu.sil).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("kosum-sil-evet"));
    await flush();
    expect(mockRaporcu.sil).toHaveBeenCalledWith(U(1));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("§9 bulut kipi aynı akışta", () => {
  it("liste ANLIK rapor-katalogu + isteklerim; ayrıntı reportGet; Raporcu hiç çağrılmaz", async () => {
    yet.setYetenek(yet.BULUT_YETENEK);
    mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: { raporlar: [] }, surum: "1" }));
    mockApi.reportList.mockResolvedValue({ kayitlar: [], sonraki: null });
    mockApi.reportGet.mockResolvedValue({ ...kosum(1), sonuc: null });
    render(<Reports />);
    await flush();
    expect(mockApi.snapshot).toHaveBeenCalledWith("rapor-katalogu");
    expect(mockApi.reportList).toHaveBeenCalledWith({ limit: 50 });
    screen.unmount();
    mockParams.value = { id: U(1) };
    render(<ReportDetail />);
    await flush();
    expect(mockApi.reportGet).toHaveBeenCalledWith(U(1));
    for (const f of Object.values(mockRaporcu)) expect(f).not.toHaveBeenCalled();
  });
});
