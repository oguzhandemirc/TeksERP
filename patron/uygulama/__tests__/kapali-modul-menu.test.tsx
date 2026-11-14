// Kapalı modül menüde yok: ERP `/auth/me` `patronClosedSets` (kurulumda bayrak/lisans kapısı kapalı kümeler) gezinme
// yüzeylerinden (ray · sekme · Diğer) modülü düşürür; alan yoksa (eski fabrika) hepsi görünür. Derin bağlantı ekranı
// yine açar: veri istenir, uç 403 verir, #709 kapalı satırı çizilir (ekran kapısı `moduleVisible` değişmedi).
import { act, render, screen } from "@testing-library/react-native";
import type React from "react";

const mockApi = { snapshot: jest.fn(), list: jest.fn(), record: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-14T09:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false, offlineSince: null,
  facility: null as unknown, facilities: [], facilityId: null, switchError: null, factoryStamp: "2026-11-14T08:55:00Z",
  switchFacility: jest.fn(async () => true),
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true, canDismiss: jest.fn(() => true), dismissAll: jest.fn() };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/teklifler",
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const access = require("../src/lib/access") as typeof import("../src/lib/access");
const { TABS, tabVisible } = require("../src/ui/tabs") as typeof import("../src/ui/tabs");
const { SideNav } = require("../src/ui/Frame") as typeof import("../src/ui/Frame");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
const Quotes = (require("../app/(app)/teklifler") as { default: () => React.ReactElement }).default;

const SETS = ["siparis", "cari-kart", "sevkiyat", "is-emri", "stok-karnesi", "kasa", "teklif", "standart-maliyet", "tesis"];
const PERMS = ["bulut:oturum", "bulut:siparis:oku", "bulut:cari:oku", "bulut:sevkiyat:oku", "bulut:uretim:oku", "bulut:stok:oku", "bulut:kasa:oku", "bulut:teklif:oku", "bulut:maliyet:oku"];
const CLOSED = ["kasa", "teklif", "teklif-kalemi", "standart-maliyet"];
const caps = (closed?: unknown) => yet.erpYetenek(SETS, ["*"], undefined, false, undefined, undefined, undefined, closed);
const menu = () => screen.getAllByTestId(/^menu-/).map((n) => String(n.props.testID).slice(5));

async function flush() {
  await act(async () => undefined);
  await act(async () => undefined);
}

afterEach(() => yet.setYetenek(yet.BULUT_YETENEK));

describe("yetenek: patronClosedSets", () => {
  it("dizi → kapalı küme; alan yok / bozuk → boş (hepsi açık, bugünkü davranış)", () => {
    expect([...caps(CLOSED).kapali].sort()).toEqual([...CLOSED].sort());
    expect(caps(undefined).kapali.size).toBe(0);
    expect(caps("kasa").kapali.size).toBe(0);
    expect(caps([1, "kasa"]).kapali.has("kasa")).toBe(true);
    expect(yet.BULUT_YETENEK.kapali.size).toBe(0);
  });
  it("kapalı küme veri katmanından DÜŞMEZ (derin bağlantı uca gider, 403 kapalı satırı)", () => {
    expect(yet.kumeSunuluyor("teklif", caps(CLOSED))).toBe(true);
  });
});

describe("gezinme yüzeyleri kapalı modülü göstermez; ekran kapısı değişmez", () => {
  it("ray: kapalı modüller (Finans, Teklifler, Standart Maliyetler) yok, açıklar var", () => {
    mockSession.permissions = PERMS;
    yet.setYetenek(caps(CLOSED));
    render(<SideNav />);
    const m = menu();
    expect(m).toEqual(expect.arrayContaining(["pano", "uretim", "siparisler", "cariler", "sevkiyat", "stok"]));
    expect(m).not.toContain("finans");
    expect(m).not.toContain("teklifler");
    expect(m).not.toContain("standart-maliyetler");
  });
  it("eski fabrika (alan yok): hepsi görünür", () => {
    mockSession.permissions = PERMS;
    yet.setYetenek(caps(undefined));
    render(<SideNav />);
    expect(menu()).toEqual(expect.arrayContaining(["finans", "teklifler", "standart-maliyetler", "uretim"]));
  });
  it("sekme ve Diğer yüklemi: finans sekmesi gizli; moduleVisible (ekran kapısı) yine true", () => {
    yet.setYetenek(caps(CLOSED));
    const finans = TABS.find((t) => t.name === "finans")!;
    expect(tabVisible(PERMS, finans)).toBe(false);
    expect(tabVisible(PERMS, TABS.find((t) => t.name === "uretim")!)).toBe(true);
    expect(access.moduleInMenu(PERMS, "teklifler")).toBe(false);
    expect(access.moduleVisible(PERMS, "teklifler")).toBe(true);
    expect(access.menuModules(PERMS).map((m) => m.key)).not.toContain("finans");
  });
  it("derin bağlantı: kapalı Teklifler ekranı açılır, uçtan 403 MODULE_DISABLED → kapalı satırı (yetki bandı DEĞİL)", async () => {
    mockSession.permissions = PERMS;
    yet.setYetenek(caps(CLOSED));
    mockApi.list.mockReset();
    mockApi.list.mockImplementation(async () => { throw new ApiError(403, "MODULE_DISABLED", "Maliyet & Teklif modülü bu kurulumda kapalı."); });
    render(<Quotes />);
    await flush();
    expect(mockApi.list).toHaveBeenCalled();
    expect(screen.getByTestId("teklifler-kapali")).toBeTruthy();
    expect(screen.queryByText("Bu bölümü görme yetkiniz yok")).toBeNull();
  });
});
