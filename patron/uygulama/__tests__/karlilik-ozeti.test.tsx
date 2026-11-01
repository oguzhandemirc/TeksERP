// D4-G4 — Finans › Kârlılık segmenti (`karlilik-ozet` anlığı, S15 a): §1 izinsiz hesapta segment YOK ve anlık istenmez ·
// §2 izinli hesapta fabrikanın rakamları ve SIRASI aynen (en kârlı / en zararlı, eksik rozeti) · §3 eski fabrika (anlık yok)
// çökmez, rapor kataloğunda anahtar yoksa ayrıntı karosu konmaz (varsa rapor isteme ekranını açar) · §4 görünüm hesap yapmaz (ton yalnız işaretten).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-10-31T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false, offlineSince: null,
  facility: null, facilities: [], switchError: null, factoryStamp: "2026-10-31T08:55:00Z",
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/finans",
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const Finance = (require("../app/(app)/(tabs)/finans") as { default: () => React.ReactElement }).default;
const view = require("../src/lib/profitability-summary") as typeof import("../src/lib/profitability-summary");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

const para = (gelir: string, katki: string | null, rozet = "") => ({ gelir, katki, net: katki, rozet });
const KARLILIK = {
  buAy: "2026-10",
  hesap: "makine süresi iş oturumundan · genel gider dağıtılmıyor",
  donem: { ...para("50000.00", "12000.00", "eksik: sarf normu"), sarf: "8000.00", makine: null, disFason: "0.00" },
  aylar: [{ ay: "2026-09", ...para("20000.00", "5000.00") }, { ay: "2026-10", ...para("30000.00", "7000.00") }],
  buAyIslemler: [{ etiket: "Kurşun dikimi", metre: "1200.00", ...para("30000.00", "7000.00") }],
  // Sıra FABRİKANIN: uygulama yeniden sıralamaz (kasıtlı olarak "küçük" önce gelirse de öyle basılır).
  enKarli: [{ etiket: "Beta Perde", ...para("9000.00", "4000.00") }, { etiket: "Alfa Tekstil", ...para("8000.00", "6000.00") }],
  enZararli: [{ etiket: "Zeta Ev", ...para("1000.00", "-250.00") }],
  hesaplanamayanMusteri: 2,
};

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

let catalog: unknown[] = [];
beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  catalog = [];
  mockApi.snapshot.mockImplementation(async (p: string) => ({
    projeksiyon: p, veri: p === "karlilik-ozet" ? KARLILIK : p === "rapor-katalogu" ? { raporlar: catalog } : {}, surum: "2026-10-31T08:55:00.000Z",
  }));
  mockApi.list.mockImplementation(async () => ({ kayitlar: [], sonraki: null }));
  mockSession.permissions = [];
});

describe("§1 izinsiz hesapta Kârlılık segmenti yok", () => {
  it("bulut:maliyet:oku yoksa segment çizilmez, karlilik-ozet istenmez", async () => {
    mockSession.permissions = ["bulut:kasa:oku", "bulut:fatura:oku", "bulut:cari-bakiye:oku", "bulut:rapor:oku"];
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("sekme-karlilik")).toBeNull();
    expect(screen.queryByTestId("karlilik-ozeti")).toBeNull();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("karlilik-ozet");
  });
});

describe("§2 izinli hesapta fabrikanın rakamları ve sırası", () => {
  it("katkı, rozet, en kârlı/en zararlı fabrikanın sırasıyla", async () => {
    mockSession.permissions = ["bulut:kasa:oku", "bulut:maliyet:oku"];
    render(<Finance />);
    await flush();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("karlilik-ozet");
    fireEvent.press(screen.getByTestId("sekme-karlilik"));
    await flush();
    expect(mockApi.snapshot).toHaveBeenCalledWith("karlilik-ozet");
    expect(screen.getByTestId("karlilik-katki").props.children).toBe("12.000 ₺");
    expect(screen.getByTestId("karlilik-rozet").props.children).toBe("eksik: sarf normu");
    expect(screen.getByText(/Makineye giden hesaplanamadı/)).toBeTruthy();
    const best = screen.getAllByText(/^(Beta Perde|Alfa Tekstil)$/).map((n) => n.props.children);
    expect(best).toEqual(["Beta Perde", "Alfa Tekstil"]);
    expect(screen.getByText("Zeta Ev")).toBeTruthy();
    expect(screen.getByText("2 müşterinin kârı eksik girdi yüzünden hesaplanamadı")).toBeTruthy();
    expect(screen.getByText("Kurşun dikimi")).toBeTruthy();
  });

  it("yalnız maliyet izinli hesap da Finans'ta Kârlılık'ı görür (tek segment)", async () => {
    mockSession.permissions = ["bulut:maliyet:oku"];
    render(<Finance />);
    await flush();
    expect(mockApi.snapshot).toHaveBeenCalledWith("karlilik-ozet");
    expect(screen.getByTestId("karlilik-katki")).toBeTruthy();
  });
});

describe("§3 eski fabrika", () => {
  it("anlık yok (404) → hata/boş görünüm, çökme yok", async () => {
    mockSession.permissions = ["bulut:maliyet:oku"];
    mockApi.snapshot.mockImplementation(async () => { throw new ApiError(404, "BULUNAMADI", "Anlık görüntü bulunamadı"); });
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("karlilik-katki")).toBeNull();
    expect(screen.queryByTestId("karlilik-ozeti-hata") ?? screen.queryByTestId("karlilik-ozeti-bos")).toBeTruthy();
  });

  it("rapor kataloğunda maliyet/karlilik yoksa ayrıntı karosu yok; varsa var", async () => {
    mockSession.permissions = ["bulut:maliyet:oku", "bulut:rapor:oku"];
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("bolum-karlilik-raporu")).toBeNull();
  });

  it("katalogda maliyet/karlilik varsa karo rapor isteme ekranını açar", async () => {
    mockSession.permissions = ["bulut:maliyet:oku", "bulut:rapor:oku"];
    catalog = [{ anahtar: "maliyet/karlilik", baslik: "Kârlılık", soru: "Hangi müşteri ne kazandırdı?", aile: "maliyet", izin: "bulut:maliyet:oku", parametreler: [], standartDonemler: [] }];
    render(<Finance />);
    await flush();
    expect(screen.getByTestId("bolum-karlilik-raporu")).toBeTruthy();
    fireEvent.press(screen.getByText("Kârlılık", { exact: true }));
    expect(mockRouter.push).toHaveBeenCalledWith(expect.objectContaining({ params: { anahtar: "maliyet/karlilik" } }));
  });

  it("şekli bozuk veri → null", () => {
    expect(view.profitView({ buAy: "2026-10" })).toBeNull();
    expect(view.profitView(null)).toBeNull();
  });
});

describe("§4 görünüm hesap yapmaz", () => {
  it("ton yalnız işaretten; null 'hesaplanamadı'", () => {
    expect(view.toneOf("-1.00")).toBe("kritik");
    expect(view.toneOf("5.00")).toBeUndefined();
    expect(view.toneOf(null)).toBe("uyari");
    expect(view.moneyOrMissing(null)).toBe("hesaplanamadı");
  });
});
