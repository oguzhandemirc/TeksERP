// E1 (Pano · Üretim · Sevkiyat): izinsiz kart çizilmez · Dikkat şeridi `saglik` başarısızsa kritik madde ·
// çalışan hesabında "Görebildiğin alanlar" · Üretim dönemi yeniden çekmeden değişir · kayıt rozeti tonu = anlam.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type React from "react";
import { createCache } from "../src/state/cache";

function mockMem() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
    removeMany: async (ks: readonly string[]) => ks.forEach((k) => m.delete(k)),
  };
}

const FIXTURES: Record<string, unknown> = {
  "ozet.siparis": { acikKalem: 12, karsilanmaYuzde: 64, gecikenKalem: 0 },
  "ozet.uretim": { bugunTamamlananToplam: 142, kolonlar: [] },
  "ozet.fason": { bugun: { acikMiktar: 1500, acikKalem: 2 }, buAy: { acikMiktar: 23120, acikKalem: 19 } },
  "uretim-akisi": { kolonlar: [], istasyonlar: [] },
  saglik: { yedek: { hukum: "ok", yasSaat: 3 } },
};

const mockApi = {
  snapshot: jest.fn(async (p: string) => ({ projeksiyon: p, veri: FIXTURES[p] ?? {}, surum: "1" })),
  list: jest.fn(async (_p: string, _o?: unknown) => ({ kayitlar: [] as unknown[], sonraki: null })),
  refresh: jest.fn(async () => ({ zil: false, sonrakiMs: 60_000 })),
};
const mockSession = {
  api: mockApi,
  cache: null as ReturnType<typeof createCache> | null,
  markOnline: jest.fn(),
  refresh: jest.fn(async () => undefined),
  permissions: [] as string[],
  facility: null as unknown,
  facilities: [] as unknown[],
  facilityId: null as string | null,
  switchError: null as string | null,
  switchFacility: jest.fn(async () => true),
  factoryStamp: null as string | null,
  feedMode: "kapali",
  offline: false,
  offlineSince: null as string | null,
};
const mockRouter = { navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/pano",
  useFocusEffect: (cb: () => unknown) => require("react").useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const Dashboard = (require("../app/(app)/(tabs)/pano") as { default: () => React.ReactElement }).default;
const Production = (require("../app/(app)/(tabs)/uretim") as { default: () => React.ReactElement }).default;
const { attentionItems, areaSummary, dueRows } = require("../src/ui/pano/read") as typeof import("../src/ui/pano/read");
const L = require("../src/lib/labels/uretim") as typeof import("../src/lib/labels/uretim");

beforeEach(() => {
  mockSession.cache = createCache(mockMem(), "t1:h1", () => new Date("2026-10-22T09:00:00Z"));
  mockApi.snapshot.mockClear();
  mockApi.list.mockClear();
  FIXTURES.saglik = { yedek: { hukum: "ok", yasSaat: 3 } };
});

describe("Pano", () => {
  it("§1 izinsiz alan kartı çizilmez", async () => {
    mockSession.permissions = ["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku"];
    render(<Dashboard />);
    expect(await screen.findByTestId("anlik-ozet.siparis")).toBeTruthy();
    expect(screen.queryByTestId("anlik-ozet-finans")).toBeNull();
    expect(screen.queryByTestId("anlik-ozet.uretim")).toBeNull();
    await waitFor(() => expect(mockApi.snapshot).toHaveBeenCalledWith("ozet.siparis"));
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("ozet-finans");
  });

  it("§2 gece yedeği alınamadıysa Dikkat şeridinde kritik madde", async () => {
    FIXTURES.saglik = { yedek: { hukum: "kritik", yasSaat: null } };
    mockSession.permissions = ["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku"];
    render(<Dashboard />);
    expect(await screen.findByTestId("dikkat-yedek")).toBeTruthy();
    expect(screen.queryByTestId("dikkat-yolunda")).toBeNull();
    const [first] = attentionItems({ health: { yedek: { hukum: "kritik" } }, orders: { gecikenKalem: 0 } });
    expect(first).toMatchObject({ key: "yedek", tone: "kritik" });
    expect(attentionItems({ health: { yedek: { hukum: "ok" } } })).toEqual([]);
  });

  it("§3 çalışan (özet izni yok): 'Görebildiğin alanlar', Dikkat şeridi yok", async () => {
    mockSession.permissions = ["bulut:oturum", "bulut:siparis:oku"];
    render(<Dashboard />);
    expect(screen.getByTestId("gorebildigin-alanlar")).toBeTruthy();
    expect(screen.getByTestId("kisayol-siparisler")).toBeTruthy();
    expect(screen.queryByTestId("dikkat")).toBeNull();
    await act(async () => undefined);
    expect(mockApi.snapshot).not.toHaveBeenCalled();
  });
});

describe("Üretim", () => {
  it("§4 dönem segmenti yeniden çekmeden farklı bölümü gösterir", async () => {
    mockSession.permissions = ["bulut:oturum", "bulut:ozet:oku", "bulut:uretim:oku"];
    mockApi.list.mockResolvedValueOnce({
      kayitlar: [
        { id: "w1", kayit: { isEmriNo: "TIE-1", durum: "IN_PROGRESS" }, surum: "1" },
        { id: "w2", kayit: { isEmriNo: "TIE-2", durum: "CANCELLED" }, surum: "1" },
      ],
      sonraki: null,
    });
    render(<Production />);
    const tile = await screen.findByTestId("kpi-fasonda");
    expect(within(tile).getByText("23.120")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("durum-w1")).toBeTruthy());
    const calls = mockApi.snapshot.mock.calls.length;
    fireEvent.press(screen.getByTestId("donem-bugun"));
    expect(within(screen.getByTestId("kpi-fasonda")).getByText("1.500")).toBeTruthy();
    expect(mockApi.snapshot.mock.calls.length).toBe(calls);
    // Rozet: Üretimde normal akıştır (uyarı değil), İptal sönüktür (kritik değil).
    expect(screen.getByTestId("durum-w1").props.accessibilityLabel).toBe("Durum: Üretimde");
    expect(screen.getByTestId("durum-w2").props.accessibilityLabel).toBe("Durum: İptal");
  });

  // D4-J5: `sevkeHazir` fabrikadan gelir; uygulama yalnız etiketler. Eski fabrika alanı göndermez → rozet yok, hata yok.
  it("§5 iş emri satırında 'Sevke hazır / Kısmen hazır' rozeti; eski fabrika (alan yok) hatasız, rozetsiz", async () => {
    mockSession.permissions = ["bulut:oturum", "bulut:uretim:oku"];
    mockApi.list.mockResolvedValueOnce({
      kayitlar: [
        { id: "h1", kayit: { isEmriNo: "TIE-H", durum: "IN_PROGRESS", sevkeHazir: { durum: "HAZIR", hazirTop: 12, hazirMetre: "1234.500" } }, surum: "1" },
        { id: "k1", kayit: { isEmriNo: "TIE-K", durum: "IN_PROGRESS", sevkeHazir: { durum: "KISMEN", hazirTop: 3, hazirMetre: 300 } }, surum: "1" },
        { id: "e1", kayit: { isEmriNo: "TIE-E", durum: "IN_PROGRESS" }, surum: "1" },
        { id: "n1", kayit: { isEmriNo: "TIE-N", durum: "IN_PROGRESS", sevkeHazir: null }, surum: "1" },
        { id: "y1", kayit: { isEmriNo: "TIE-Y", durum: "IN_PROGRESS", sevkeHazir: { durum: "YOK", hazirTop: 0, hazirMetre: "0" } }, surum: "1" },
      ],
      sonraki: null,
    });
    render(<Production />);
    await waitFor(() => expect(screen.getByTestId("durum-e1")).toBeTruthy());
    expect(screen.getByTestId("sevke-hazir-h1")).toBeTruthy();
    expect(within(screen.getByTestId("kayit-h1")).getByText("Sevke hazır: 12 top · 1.235 m")).toBeTruthy();
    expect(screen.getByTestId("sevke-hazir-k1")).toBeTruthy();
    expect(within(screen.getByTestId("kayit-k1")).getByText("Kısmen hazır: 3 top · 300 m")).toBeTruthy();
    for (const id of ["e1", "n1", "y1"]) expect(screen.queryByTestId(`sevke-hazir-${id}`)).toBeNull();
  });

  it("§6 görünüm sınıflamaz: bilinmeyen kod ve bozuk alan rozet çizmez", () => {
    const { shipReadinessView } = require("../src/lib/ship-readiness") as typeof import("../src/lib/ship-readiness");
    expect(shipReadinessView({})).toBeNull();
    expect(shipReadinessView({ sevkeHazir: "HAZIR" })).toBeNull();
    expect(shipReadinessView({ sevkeHazir: { durum: "YENI", hazirTop: 5 } })).toBeNull();
    // Görünüm sayılardan durum çıkarmaz: fabrika KISMEN dediyse metre ne olursa olsun KISMEN kalır.
    expect(shipReadinessView({ sevkeHazir: { durum: "KISMEN", hazirTop: 99, hazirMetre: 99999 } })?.label).toBe("Kısmen hazır");
  });
});

describe("kayıt durumu tonu = anlam (tek kaynak `labels/uretim`)", () => {
  it("iş emri: Planlandı nötr · Üretimde etkin · Tamamlandı iyi · İptal/Devredildi sönük", () => {
    expect(Object.fromEntries(Object.entries(L.WORK_ORDER_STATUS).map(([k, v]) => [k, v.tone]))).toEqual({
      PLANNED: "notr",
      IN_PROGRESS: "etkin",
      COMPLETED: "iyi",
      CANCELLED: "sonuk",
      SUPERSEDED: "sonuk",
    });
  });
  it("sevkiyat: Onay bekliyor nötr · Sevk edildi iyi · İptal sönük", () => {
    expect(Object.fromEntries(Object.entries(L.SHIPMENT_STATUS).map(([k, v]) => [k, v.tone]))).toEqual({ PLANNED: "notr", DISPATCHED: "iyi", CANCELLED: "sonuk" });
  });
  it("fabrika arıza/gecikme durumu vermediği için iş emri ve sevkiyat sözlüklerinde uyarı/kritik yok", () => {
    const tones = [...Object.values(L.WORK_ORDER_STATUS), ...Object.values(L.SHIPMENT_STATUS)].map((e) => e.tone);
    expect(tones).not.toContain("uyari");
    expect(tones).not.toContain("kritik");
  });
  it("ölü stok uyarıdır, kritik değil; bilinmeyen durum nötr çizilir", () => {
    expect(L.DEAD_STOCK_STATUS.var.tone).toBe("uyari");
    expect(L.recordStatus(L.WORK_ORDER_STATUS, "YENI_DURUM")).toEqual({ label: "YENI_DURUM", tone: "notr" });
  });
});

describe("okuyucular", () => {
  it("dueRows toplamaz; TL ve alınan önce gelir", () => {
    const rows = dueRows(
      {
        cekVade: [
          { kova: "SOON", tur: "ISSUED", doviz: "USD", adet: 1, tutar: "100" },
          { kova: "SOON", tur: "ISSUED", doviz: "TRY", adet: 2, tutar: "200" },
          { kova: "SOON", tur: "RECEIVED", doviz: "TRY", adet: 3, tutar: "300" },
          { kova: "LATER", tur: "RECEIVED", doviz: "TRY", adet: 9, tutar: "900" },
        ],
      },
      ["SOON"],
    );
    expect(rows.map((r) => `${r.currency}/${r.kind}/${r.amount}`)).toEqual(["TRY/RECEIVED/300", "TRY/ISSUED/200", "USD/ISSUED/100"]);
  });
  it("areaSummary ham anahtar basmaz", () => {
    const text = areaSummary("ozet.siparis", { acikKalem: 12, karsilanmaYuzde: 64 });
    expect(text).toContain("açık kalem");
    expect(text).not.toMatch(/acikKalem|karsilanma/);
  });
});
