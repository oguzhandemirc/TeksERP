// R1-BULUT bekçisi — v2 rapor sonucu (`RaporSunumu`) görünümü: §1 ana sayı birimli biçimlenir, "ölçülemedi" 0'a
// çökmez · §2 kıyas yönü/rengi fabrikanın `yon`/`durum`undan (uygulama kıyas hesaplamaz) · §3 boş tablo "kayıt yok" ·
// §4 ayrıntı ekranı v2 anahtarında sunumu, eski anahtarda jenerik görünümü çizer · §5 istek gövdesi (aralık adları,
// v2'de süzgeç sorulmaz) ve eski uygulamanın tanımadığı anahtarı listelememesi.
import { act, render, screen } from "@testing-library/react-native";
import type React from "react";
import type { RaporSunumu } from "../src/api/wire";

const mockApi = { snapshot: jest.fn(), reportGet: jest.fn(), reportCancel: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-10-25T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: ["bulut:rapor:oku", "bulut:sevkiyat:oku"] as string[], offline: false, offlineSince: null,
  facility: null, facilities: [], switchError: null, factoryStamp: "2026-10-25T08:55:00Z",
};
const mockParams: { value: Record<string, string> } = { value: {} };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true }),
  usePathname: () => "/raporlar",
  useLocalSearchParams: () => mockParams.value,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { SunumGorunumu, comparisonView, figureText, primarySeries, UNMEASURED } = require("../src/ui/raporlar/SunumGorunumu") as typeof import("../src/ui/raporlar/SunumGorunumu");
const reports = require("../src/lib/reports") as typeof import("../src/lib/reports");
const ReportDetail = (require("../app/(app)/raporlar/[id]") as { default: () => React.ReactElement }).default;

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

function sample(over: Partial<RaporSunumu> = {}): RaporSunumu {
  return {
    anahtar: "sales/sevkiyat", baslik: "Ne sevk ettik?", soru: "Bu dönemde kime kaç metre sevk ettik?",
    donem: { from: "2026-08-31T21:00:00.000Z", to: "2026-09-30T20:59:59.999Z", etiket: "Eylül 2026" },
    kiyasDonemi: { from: "2026-07-31T21:00:00.000Z", to: "2026-08-31T20:59:59.999Z", etiket: "Ağustos 2026" },
    anaSayi: { olcu: "sevk.metre", ad: "Sevk edilen metre", deger: 12500.5, birim: "m", kiyas: { deger: 10000, fark: 2500.5, yuzde: 25.005, yon: "artti", durum: "iyi" } },
    yanSayilar: [
      { olcu: "sevk.tutar", ad: "Sevk tutarı", deger: 845000, birim: "TRY" },
      { olcu: "sevk.top", ad: "Top", deger: null, birim: "top", olculemedi: "Top sayısı yok" },
      { olcu: "sevk.ihracat", ad: "İhracat payı", deger: 12.5, birim: "yuzde" },
      { olcu: "sevk.fazla", ad: "Dördüncü", deger: 1, birim: "adet" },
    ],
    anlati: [
      { kural: "a", onem: 0.9, metin: "Birinci cümle.", kanit: {} },
      { kural: "b", onem: 0.8, metin: "İkinci cümle.", kanit: {} },
      { kural: "c", onem: 0.7, metin: "Üçüncü cümle.", kanit: {} },
      { kural: "d", onem: 0.6, metin: "Dördüncü cümle.", kanit: {} },
    ],
    grafik: { tur: "cubuk", eksen: { x: { ad: "Müşteri", tur: "kategori" }, y: { ad: "Metre", birim: "m" } }, seriler: [{ ad: "Önceki", veri: [1, 2], soluk: true }, { ad: "Bu dönem", veri: [8000, 4500.5] }], kategoriler: ["Alfa", "Beta"] },
    tablo: { kolonlar: [{ anahtar: "musteri", baslik: "Müşteri" }, { anahtar: "metre", baslik: "Metre", birim: "m" }], satirlar: [{ musteri: "Alfa", metre: 8000 }] },
    tanimlar: [], parametreler: [], uyarilar: [],
    ...over,
  };
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: { raporlar: [] }, surum: "1" }));
  mockParams.value = {};
});

describe("§1 ana sayı ve ölçülemedi", () => {
  it("birimli biçim: metre 1 ondalık, para 0 ondalık, yüzde öne", () => {
    expect(figureText(12500.5, "m")).toBe("12.500,5 m");
    expect(figureText(845000.4, "TRY")).toBe("845.000 TL");
    expect(figureText(12.5, "yuzde")).toBe("%12,5");
  });
  it("null değer 'Ölçülemedi' — asla 0", () => {
    expect(figureText(null, "m")).toBe(UNMEASURED);
    expect(figureText(undefined, "TRY")).toBe(UNMEASURED);
    render(<SunumGorunumu sunum={sample({ anaSayi: { olcu: "x", ad: "Zamanında teslim", deger: null, birim: "yuzde", olculemedi: "Termini olan sipariş yok" } })} domain="sevkiyat" />);
    expect(screen.getByTestId("sunum-ana-deger").props.children).toBe(UNMEASURED);
    expect(screen.getByTestId("sunum-olculemedi").props.children).toBe("Termini olan sipariş yok");
    expect(screen.queryByText("%0")).toBeNull();
    expect(screen.queryByTestId("sunum-kiyas")).toBeNull();
  });
  it("ölçülen ana sayı, en çok 3 yan sayı ve ilk 3 anlatı cümlesi çizilir", () => {
    render(<SunumGorunumu sunum={sample()} domain="sevkiyat" />);
    expect(screen.getByTestId("sunum-ana-deger").props.children).toBe("12.500,5 m");
    expect(screen.getByTestId("sunum-yan-sevk.tutar")).toBeTruthy();
    expect(screen.queryByTestId("sunum-yan-sevk.fazla")).toBeNull();
    expect(screen.getByText("Ne görüyoruz?")).toBeTruthy();
    expect(screen.getByText("Üçüncü cümle.")).toBeTruthy();
    expect(screen.queryByText("Dördüncü cümle.")).toBeNull();
  });
});

describe("§2 kıyas yönü ve rengi fabrikadan", () => {
  it("artış + iyi → yukarı ok, iyi tonu, yüzde fabrikanınki", () => {
    expect(comparisonView({ deger: 10, fark: 2.5, yuzde: 25.005, yon: "artti", durum: "iyi" }, "m")).toEqual({ icon: "arrow-up", tone: "iyi", text: "%25 arttı" });
  });
  it("artış + kötü (ör. fire) → yukarı ok ama kritik tonu", () => {
    expect(comparisonView({ deger: 10, fark: 2, yuzde: 20, yon: "artti", durum: "kotu" }, "m")?.tone).toBe("kritik");
  });
  it("azalış + nötr → aşağı ok, renksiz; yüzde yoksa fark birimli", () => {
    expect(comparisonView({ deger: 0, fark: -40, yuzde: null, yon: "azaldi", durum: "notr" }, "m")).toEqual({ icon: "arrow-down", tone: null, text: "40 m azaldı" });
  });
  it("ölçülemeyen kıyas sayı uydurmaz; kıyas yoksa rozet yok", () => {
    expect(comparisonView({ deger: null, fark: null, yuzde: null, yon: null, durum: "notr" }, "m")?.text).toBe("Kıyas ölçülemedi");
    expect(comparisonView(undefined, "m")).toBeNull();
  });
  it("ekranda kıyas rozeti ton testID'siyle ve kıyas dönemiyle çizilir", () => {
    render(<SunumGorunumu sunum={sample()} domain="sevkiyat" />);
    expect(screen.getByTestId("sunum-kiyas-iyi")).toBeTruthy();
    expect(screen.getByText("· Ağustos 2026")).toBeTruthy();
  });
  it("ana grafik soluk (önceki dönem) olmayan seriyi çizer", () => {
    expect(primarySeries(sample().grafik)?.name).toBe("Bu dönem");
  });
});

describe("§3 tablo", () => {
  it("boş tablo 'kayıt yok' der; grafik verisi yoksa grafik kartı çizilmez", () => {
    render(<SunumGorunumu sunum={sample({ tablo: { kolonlar: [{ anahtar: "a", baslik: "A" }], satirlar: [] }, grafik: null })} domain="sevkiyat" />);
    expect(screen.getByTestId("sunum-tablo-bos")).toBeTruthy();
    expect(screen.queryByTestId("sunum-grafik")).toBeNull();
  });
  it("dolu tablo satırı birimli hücreyle çizilir", () => {
    render(<SunumGorunumu sunum={sample()} domain="sevkiyat" />);
    // Hem grafik çubuğunda hem tablo hücresinde aynı fabrika sayısı.
    expect(screen.getAllByText("8.000 m").length).toBe(2);
  });
});

describe("§4 ayrıntı ekranı", () => {
  const istek = (raporAnahtari: string, veri: unknown) => ({
    id: "00000000-0000-4000-8000-000000000001", raporAnahtari, aile: raporAnahtari.split("/")[0], parametreler: {}, durum: "HAZIR", hataKodu: null,
    olusturulma: "2026-10-25T09:00:00Z", tamamlanma: "2026-10-25T09:01:00Z", sonuc: { veri, hesaplandi: "2026-10-25T09:01:00Z", kaynakUfuk: null },
  });
  it("v2 anahtarı + sunum → SunumGorunumu", async () => {
    mockParams.value = { id: "00000000-0000-4000-8000-000000000001" };
    mockApi.reportGet.mockResolvedValue(istek("sales/sevkiyat", sample()));
    render(<ReportDetail />);
    await flush();
    expect(screen.getByTestId("sunum")).toBeTruthy();
    expect(screen.queryByTestId("rapor-sonuc")).toBeNull();
  });
  it("eski anahtar → bugünkü jenerik görünüm (değişmedi)", async () => {
    mockParams.value = { id: "00000000-0000-4000-8000-000000000001" };
    mockApi.reportGet.mockResolvedValue(istek("inventory/scorecard", { toplam: 3 }));
    render(<ReportDetail />);
    await flush();
    expect(screen.getByTestId("rapor-sonuc")).toBeTruthy();
    expect(screen.queryByTestId("sunum")).toBeNull();
  });
  it("v2 anahtarı ama biçimsiz sonuç → jenerik görünüme düşer (çökme yok)", async () => {
    mockParams.value = { id: "00000000-0000-4000-8000-000000000001" };
    mockApi.reportGet.mockResolvedValue(istek("sales/sevkiyat", { x: 1 }));
    render(<ReportDetail />);
    await flush();
    expect(screen.getByTestId("rapor-sonuc")).toBeTruthy();
  });
});

describe("§5 istek gövdesi ve tanınan anahtarlar", () => {
  it("aralık adı katalogdan: ISO raporlar dateFrom/dateTo, dokuma from/to", () => {
    expect(reports.rangeParamNames(["dateFrom", "dateTo", "kiyas"])).toEqual(["dateFrom", "dateTo"]);
    expect(reports.rangeParamNames(["from", "to", "kiyas"])).toEqual(["from", "to"]);
    expect(reports.rangeParamNames(["asOf"])).toBeNull();
    expect(reports.buildReportParams("01.09.2026", "30.09.2026", {}, ["from", "to"])).toEqual({ ok: true, params: { from: "2026-09-01", to: "2026-09-30" } });
    expect(reports.extraParamNames(["from", "to", "kiyas", "shiftDefinitionId"])).toEqual(["kiyas", "shiftDefinitionId"]);
  });
  it("her v2 anahtarı izin eşlemesinde; kişi adlı üretim akışı buluttan istenemez", () => {
    for (const k of reports.PRESENTATION_REPORT_KEYS) expect(Object.keys(reports.REPORT_KEY_PERMISSION)).toContain(k);
    expect(reports.requestable("production/uretim-akisi", ["bulut:rapor:oku", "bulut:uretim:oku"])).toBe(false);
    expect(reports.requestable("sales/sevkiyat", ["bulut:rapor:oku", "bulut:sevkiyat:oku"])).toBe(true);
    // Uygulamanın tanımadığı (eşlemede olmayan) anahtar listede çizilmez — eski uygulama yeni anahtarı görmez.
    expect(reports.requestable("sales/gelecek-rapor", ["bulut:rapor:oku", "bulut:siparis:oku"])).toBe(false);
  });
});
