// D4-H2 — Finans › Masraf segmenti (`ozet-masraf` anlığı): §1 izinsiz hesapta segment YOK ve anlık istenmez ·
// §2 izinli hesapta fabrikanın rakamları aynen (toplam, fark, ilk 15 + "Diğer") · §3 eski fabrika (anlık 404) boş durum ·
// §4 görünüm hesap yapmaz (fark yönü işaretten; tutar yalnız biçimlenir).
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
const view = require("../src/lib/expense-summary") as typeof import("../src/lib/expense-summary");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

const ay = (tutar: string) => [{ ay: "2026-09", tutar: "0.00" }, { ay: "2026-10", tutar }];
const kategori = (i: number) => ({
  etiket: `Kategori ${i}`, digerMi: false, kategoriSayisi: 1, toplam: "1000.00", buAy: "100.00", gecenAy: "40.00", fark: "60.00", buAyPay: 5.5, aylik: ay("100.00"),
});
const MASRAF = {
  aylar: ["2026-09", "2026-10"], buAy: "2026-10", gecenAy: "2026-09", toplam: "16500.00", buAyToplam: "1825.50", gecenAyToplam: "2000.00", fark: "-174.50",
  aylikToplam: ay("1825.50"),
  kategoriler: [
    ...Array.from({ length: 15 }, (_, i) => kategori(i + 1)),
    { etiket: "Diğer", digerMi: true, kategoriSayisi: 4, toplam: "1500.00", buAy: "325.50", gecenAy: "325.50", fark: "0.00", buAyPay: 17.8, aylik: ay("325.50") },
  ],
};

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

beforeEach(() => {
  for (const f of Object.values(mockApi)) f.mockReset();
  mockApi.snapshot.mockImplementation(async (p: string) => ({ projeksiyon: p, veri: p === "ozet-masraf" ? MASRAF : {}, surum: "2026-10-31T08:55:00.000Z" }));
  mockApi.list.mockImplementation(async () => ({ kayitlar: [], sonraki: null }));
  mockSession.permissions = [];
});

describe("§1 izinsiz hesapta Masraf segmenti yok", () => {
  it("bulut:kasa:oku yoksa segment çizilmez, ozet-masraf istenmez", async () => {
    mockSession.permissions = ["bulut:fatura:oku", "bulut:cari-bakiye:oku", "bulut:tahsilat:oku"];
    render(<Finance />);
    await flush();
    expect(screen.queryByTestId("sekme-masraf")).toBeNull();
    expect(screen.queryByTestId("masraf-ozeti")).toBeNull();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("ozet-masraf");
  });
});

describe("§2 izinli hesapta fabrikanın rakamları", () => {
  it("segmente dokununca toplam, fark ve 15 + Diğer satırı aynen", async () => {
    mockSession.permissions = ["bulut:kasa:oku"];
    render(<Finance />);
    await flush();
    expect(mockApi.snapshot).not.toHaveBeenCalledWith("ozet-masraf");
    fireEvent.press(screen.getByTestId("sekme-masraf"));
    await flush();
    expect(mockApi.snapshot).toHaveBeenCalledWith("ozet-masraf");
    expect(screen.getByText("Ekim 2026 harcanan")).toBeTruthy();
    expect(screen.getByTestId("masraf-toplam").props.children).toBe("1.825,5 ₺");
    expect(screen.getByTestId("masraf-fark").props.children).toBe("Geçen aya göre 174,5 ₺ azaldı");
    expect(screen.getByText("Diğer (4 kategori)")).toBeTruthy();
    expect(screen.getAllByText(/^Kategori \d+$/)).toHaveLength(15);
    expect(screen.getAllByText("Geçen aya göre 60 ₺ arttı")).toHaveLength(15);
    expect(screen.getByText("Geçen aya göre değişmedi")).toBeTruthy();
  });
});

describe("§3 eski fabrika: anlık yok", () => {
  it("404 → hata DEĞİL boş durum ('henüz gelmedi'), çökme yok (D4-KUC3c)", async () => {
    mockSession.permissions = ["bulut:kasa:oku"];
    mockApi.snapshot.mockImplementation(async () => { throw new ApiError(404, "BULUNAMADI", "Anlık görüntü bulunamadı"); });
    render(<Finance />);
    await flush();
    fireEvent.press(screen.getByTestId("sekme-masraf"));
    await flush();
    expect(screen.queryByTestId("masraf-toplam")).toBeNull();
    expect(screen.getByTestId("masraf-ozeti-bos")).toBeTruthy();
    expect(screen.queryByTestId("masraf-ozeti-hata")).toBeNull();
  });

  it("şekli bozuk veri → 'henüz gelmedi', çökme yok", () => {
    expect(view.expenseView({ kasa: "1" })).toBeNull();
    expect(view.expenseView(null)).toBeNull();
  });
});

describe("§4 görünüm hesap yapmaz", () => {
  it("fark yönü yalnız işaretten; sıfır 'değişmedi'", () => {
    expect(view.changeText("12.30")).toEqual({ text: "12,3 ₺ arttı", tone: "artis" });
    expect(view.changeText("-0.00").tone).toBe("yok");
    expect(view.changeText("bozuk").tone).toBe("yok");
  });
  it("ay etiketi", () => {
    expect(view.monthLabel("2026-01")).toBe("Ocak 2026");
    expect(view.monthLabel("x")).toBe("x");
  });
});
