// "Diğer" dilimi ekranları: tema seçimi anında uygulanır ve saklanır · hesap ayrıntısında ham izin kodu görünmez ·
// gelen kutusu süzgeci sunucuya gider (istemci süzmez) · Diğer'de bekleyen rozeti · gövde özeti · kısa yoklama.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import type { Account, InboxItem } from "../src/api/wire";

const mockApi = {
  inboxList: jest.fn(async (_p: unknown) => ({ kayitlar: [], sonraki: null })),
  accountUpdate: jest.fn(async (_id: string, b: { izinler: string[] }) => ({ ...ACC, izinler: b.izinler })),
  accountList: jest.fn(),
  permissions: jest.fn(),
  changePassword: jest.fn(),
};
const mockSession = {
  api: mockApi, permissions: ["bulut:hesap:yonet", "bulut:siparis:yaz"] as string[], facility: { tesis: { id: "t", ad: "Örnek Tekstil", saklamaAy: 13 }, hesap: { ad: "Ayşe Yılmaz", eposta: "a@ornek.invalid" }, esitleme: null } as unknown,
  facilities: [] as unknown[], facilityId: "t", offline: false, offlineSince: null, switchError: null, logout: jest.fn(),
};
const ACC: Account = { id: "h1", eposta: "b@ornek.invalid", ad: "Bora Kaya", durum: "AKTIF", izinler: ["bulut:siparis:oku"], sonGiris: null, davetBitis: null, olusturulma: "2026-10-01T00:00:00Z" };
const CATALOG = { izinler: ["bulut:ozet:oku", "bulut:siparis:oku", "bulut:kasa:oku", "bulut:hesap:yonet"], sablonlar: { SATIS: ["bulut:ozet:oku", "bulut:siparis:oku"], PATRON: ["bulut:ozet:oku", "bulut:siparis:oku", "bulut:kasa:oku", "bulut:hesap:yonet"] } };
const mockRemote: { calls: { key: string | null; fetcher: () => Promise<unknown> }[]; data: Record<string, unknown> } = { calls: [], data: {} };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("../src/state/useRemote", () => ({
  useRemote: (key: string | null, fetcher: () => Promise<unknown>) => {
    mockRemote.calls.push({ key, fetcher });
    const prefix = key ? Object.keys(mockRemote.data).find((k) => key === k || key.startsWith(`${k}:`)) : undefined;
    return { data: prefix ? mockRemote.data[prefix] : null, error: null, loading: false, refreshing: false, stale: false, offline: false, savedAt: null, reload: jest.fn() };
  },
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/x", useLocalSearchParams: () => ({ id: "h1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

// mock'lar kurulduktan SONRA yüklenir.
const Profile = (require("../app/(app)/profil") as typeof import("../app/(app)/profil")).default;
const AccountDetail = (require("../app/(app)/hesaplar/[id]") as typeof import("../app/(app)/hesaplar/[id]")).default;
const Inbox = (require("../app/(app)/gelen-kutusu/index") as typeof import("../app/(app)/gelen-kutusu/index")).default;
const More = (require("../app/(app)/(tabs)/diger") as typeof import("../app/(app)/(tabs)/diger")).default;
const { ThemeProvider, useTokens } = require("../src/ui/theme-context") as typeof import("../src/ui/theme-context");
const { inboxBody, inboxOverdue, inboxSummary } = require("../src/ui/diger/inbox-format") as typeof import("../src/ui/diger/inbox-format");
const { useSettlePoll } = require("../src/ui/diger/useSettlePoll") as typeof import("../src/ui/diger/useSettlePoll");

beforeEach(() => {
  mockRemote.calls = [];
  mockRemote.data = {};
  jest.clearAllMocks();
});

function Probe() {
  return <Text testID="sema">{useTokens().scheme}</Text>;
}

describe("profil: görünüm", () => {
  it("⭐ Sistem · Açık · Koyu seçimi anında uygulanır ve cihazda saklanır", async () => {
    const store = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
    render(<ThemeProvider store={store}><Profile /><Probe /></ThemeProvider>);
    await act(async () => undefined);
    expect(screen.getByTestId("sema").props.children).toBe("light");
    fireEvent.press(screen.getByTestId("tema-koyu"));
    expect(screen.getByTestId("sema").props.children).toBe("dark");
    expect(store.set).toHaveBeenCalledWith("patron.tema", "koyu");
    fireEvent.press(screen.getByTestId("tema-acik"));
    expect(screen.getByTestId("sema").props.children).toBe("light");
  });
  it("lacivert kartta rol: hesap yönetimi izni Yönetici", () => {
    render(<Profile />);
    expect(screen.getByTestId("profil-rol").props.accessibilityLabel).toBe("Rol: Yönetici");
    expect(screen.getByText("Ayşe Yılmaz")).toBeTruthy();
  });
  it("parola değişimi ayrı sayfada açılır", () => {
    render(<Profile />);
    expect(screen.queryByTestId("parola-sayfasi")).toBeNull();
    fireEvent.press(screen.getByTestId("parola-degistir"));
    expect(screen.getByTestId("parola-sayfasi")).toBeTruthy();
  });
});

describe("hesap ayrıntısı: izinler", () => {
  it("⭐ izinler Türkçe ad + açıklamayla, gruplu; ham kod ekranda YOK; kayıt aynı uca gider", async () => {
    mockRemote.data = { hesaplar: [ACC], izinler: CATALOG };
    render(<AccountDetail />);
    expect(screen.queryAllByText(/bulut:/)).toHaveLength(0);
    expect(screen.getByText("Siparişleri görme")).toBeTruthy();
    expect(screen.getAllByText("Hesap yönetimi").length).toBeGreaterThan(0);
    expect(screen.getByText("Finans")).toBeTruthy();
    expect(screen.getByTestId("hesap-rol").props.accessibilityLabel).toBe("Rol: Çalışan");
    fireEvent.press(screen.getByText("Kasa"));
    expect(screen.getByTestId("izin-degisti")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("izin-kaydet")));
    expect(mockApi.accountUpdate).toHaveBeenCalledWith("h1", expect.objectContaining({ izinler: ["bulut:siparis:oku", "bulut:kasa:oku"] }));
  });
  it("şablon çipi kümeyi doldurur (kaydetmez)", () => {
    mockRemote.data = { hesaplar: [ACC], izinler: CATALOG };
    render(<AccountDetail />);
    fireEvent.press(screen.getByTestId("sablon-PATRON"));
    expect(screen.getByTestId("sablon-PATRON").props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(mockApi.accountUpdate).not.toHaveBeenCalled();
  });
});

describe("gelen kutusu", () => {
  it("⭐ segment süzgeci sunucuya gider: anahtar ve istek `durum` taşır", async () => {
    render(<Inbox />);
    expect(mockRemote.calls.at(-1)!.key).toBe("gelen-kutusu:BEKLIYOR");
    fireEvent.press(screen.getByTestId("sekme-REDDEDILDI"));
    const last = mockRemote.calls.at(-1)!;
    expect(last.key).toBe("gelen-kutusu:REDDEDILDI");
    await last.fetcher();
    expect(mockApi.inboxList).toHaveBeenLastCalledWith({ durum: "REDDEDILDI", limit: 50 });
    fireEvent.press(screen.getByTestId("sekme-HEPSI"));
    await mockRemote.calls.at(-1)!.fetcher();
    expect(mockApi.inboxList).toHaveBeenLastCalledWith({ durum: undefined, limit: 50 });
  });
  it("Diğer: bekleyen talep sayısı rozeti (sunucu sayfası; sonraki varsa +)", () => {
    const m = { mesajId: "m1" } as InboxItem;
    mockRemote.data = { "gelen-kutusu": { kayitlar: [m, { ...m, mesajId: "m2" }], sonraki: "x" } };
    render(<More />);
    expect(mockRemote.calls[0]!.key).toBe("gelen-kutusu:BEKLIYOR");
    expect(screen.getByTestId("gelen-rozet")).toBeTruthy();
    expect(screen.getByText("2+")).toBeTruthy();
    expect(screen.getByTestId("menu-hesaplar")).toBeTruthy();
  });
  it("gövde özeti ve ayrıntı: kimlik değil ad/sayı; 24 saat uyarısı yalnız bekleyende", () => {
    const order = { tur: "SIPARIS" as const, govde: { cariKartId: "c-uuid", doviz: "USD", termin: "2026-11-20", kalemler: [{ urunId: "u-uuid", miktar: "100.5", birim: "MT" }, { urunId: "u2", miktar: "50", birim: "MT", musteriUrunAdi: "Pamuklu", birimFiyat: "2.5" }] } };
    expect(inboxSummary(order)).toBe("2 kalem · 150,5 mt · termin 20.11.2026");
    const b = inboxBody(order)!;
    expect(JSON.stringify(b)).not.toMatch(/uuid/);
    expect(b.lines.map((l) => l.title)).toEqual(["1. kalem", "Pamuklu"]);
    expect(b.lines[1]!.detail).toBe("Birim fiyat: 2,5 $");
    expect(inboxSummary({ tur: "CARI", govde: { ad: "Deniz Tekstil", roller: { musteri: true, tedarikci: false }, il: "Bursa" } })).toBe("Deniz Tekstil · Müşteri · Bursa");
    const old = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(inboxOverdue({ durum: "BEKLIYOR", olusturulma: old })).toBe(true);
    expect(inboxOverdue({ durum: "ISLENDI", olusturulma: old })).toBe(false);
  });
});

describe("kısa yoklama", () => {
  function Poller({ active, reload }: { active: boolean; reload: () => void }) {
    useSettlePoll(active, reload, [3_000, 6_000]);
    return null;
  }
  it("bekleyen varken 3 → 6 sn aralıkla tazeler, bütçe bitince durur; bekleyen yoksa hiç", () => {
    jest.useFakeTimers();
    const reload = jest.fn();
    const r = render(<Poller active reload={reload} />);
    act(() => jest.advanceTimersByTime(2_999));
    expect(reload).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(6_000));
    expect(reload).toHaveBeenCalledTimes(2);
    act(() => jest.advanceTimersByTime(60_000));
    expect(reload).toHaveBeenCalledTimes(2);
    r.unmount();
    const idle = jest.fn();
    render(<Poller active={false} reload={idle} />);
    act(() => jest.advanceTimersByTime(60_000));
    expect(idle).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
