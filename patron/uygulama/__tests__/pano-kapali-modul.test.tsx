// Kapalı modülün yerel pano kutusu: `/auth/me` `patronClosedSets` modülü kapatınca kutu panoda ve düzenleyicinin
// "ekle" listesinde yok; kullanıcının kayıtlı düzeni SİLİNMEZ (başka kutuyla oynasa da), modül açılınca kutu geri gelir.
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type React from "react";
import { createCache } from "../src/state/cache";

function mockMemStore() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
    removeMany: async (ks: readonly string[]) => ks.forEach((k) => m.delete(k)),
  };
}
const mockPlain = mockMemStore();
jest.mock("../src/state/store", () => ({ plainStore: mockPlain, secretStore: mockPlain, legacyPlainStore: null }));

const FIXTURES: Record<string, unknown> = {
  "ozet.siparis": { acikKalem: 12, karsilanmaYuzde: 64, gecikenKalem: 0 },
  "ozet.uretim": { bugunTamamlananToplam: 142, kolonlar: [] },
  "ozet-finans": {},
  saglik: { yedek: { hukum: "ok", yasSaat: 3 } },
};
const mockApi = {
  snapshot: jest.fn(async (p: string) => ({ projeksiyon: p, veri: FIXTURES[p] ?? {}, surum: "1" })),
  refresh: jest.fn(async () => ({ zil: false, sonrakiMs: 60_000 })),
};
const mockSession = {
  api: mockApi,
  cache: null as ReturnType<typeof createCache> | null,
  markOnline: jest.fn(),
  refresh: jest.fn(async () => null),
  permissions: ["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku", "bulut:uretim:oku", "bulut:cari-bakiye:oku"],
  facility: null,
  facilities: [],
  facilityId: null,
  switchError: null,
  switchFacility: jest.fn(async () => true),
  factoryStamp: null,
  feedMode: "kapali",
  offline: false,
  offlineSince: null,
  scope: "t1:h1",
  panocu: { katalog: jest.fn(), veri: jest.fn() },
};
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn() }),
  usePathname: () => "/pano",
  useFocusEffect: (cb: () => unknown) => require("react").useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const Y = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const Dashboard = (require("../app/(app)/(tabs)/pano") as { default: () => React.ReactElement }).default;

const KEY = "patron.pano.t1:h1";
const FINANS_KAPALI = { ...Y.BULUT_YETENEK, kapali: new Set(["kasa"]) };
const kayitli = () => (JSON.parse(mockPlain.m.get(KEY) ?? "null") as { kutular?: string[] } | null)?.kutular;

beforeEach(() => {
  mockPlain.m.clear();
  mockSession.cache = createCache(mockMemStore(), "t1:h1", () => new Date("2026-11-14T09:00:00Z"));
  mockApi.snapshot.mockClear();
});
afterEach(() => Y.setYetenek(Y.BULUT_YETENEK));

describe("yerel pano: kapalı modülün kutusu", () => {
  it("varsayılan düzen: Finans kapalıyken 'Vadesi yaklaşan' yok, ekle listesinde de yok; açık modüllerin kutuları var", async () => {
    Y.setYetenek(FINANS_KAPALI);
    render(<Dashboard />);
    expect(await screen.findByTestId("kpi-acik-siparis")).toBeTruthy();
    expect(screen.getByTestId("pano-kahraman")).toBeTruthy();
    expect(screen.queryByTestId("kpi-vade")).toBeNull();
    expect(screen.queryByTestId("finans-kapali")).toBeNull();
    fireEvent.press(screen.getByTestId("pano-duzenle"));
    expect(screen.getByTestId("duzen-acikSiparis")).toBeTruthy();
    expect(screen.queryByTestId("duzen-vade")).toBeNull();
    expect(screen.queryByTestId("ekle-vade")).toBeNull();
  });

  it("kayıtlı düzendeki kapalı kutu sessizce atlanır; başka kutuyla oynamak düzenden SİLMEZ; modül açılınca yerinde geri gelir", async () => {
    mockPlain.m.set(KEY, JSON.stringify({ kutular: ["acikSiparis", "vade", "kahraman"] }));
    Y.setYetenek(FINANS_KAPALI);
    const r = render(<Dashboard />);
    expect(await screen.findByTestId("pano-kahraman")).toBeTruthy();
    expect(screen.queryByTestId("kpi-vade")).toBeNull();

    fireEvent.press(screen.getByTestId("pano-duzenle"));
    fireEvent.press(screen.getByTestId("cikar-kahraman"));
    await waitFor(() => expect(kayitli()).toEqual(["acikSiparis", "vade"]));
    fireEvent.press(screen.getByTestId("ekle-fason"));
    await waitFor(() => expect(kayitli()).toEqual(["acikSiparis", "vade", "fason"]));
    fireEvent.press(screen.getByTestId("yukari-fason"));
    await waitFor(() => expect(kayitli()).toEqual(["fason", "acikSiparis", "vade"]));
    expect(screen.queryByTestId("kpi-vade")).toBeNull();

    // Modül açıldı (`/auth/me` tazelendi): kutu kullanıcının bıraktığı yerde geri gelir.
    Y.setYetenek(Y.BULUT_YETENEK);
    r.rerender(<Dashboard />);
    expect(await screen.findByTestId("kpi-vade")).toBeTruthy();
    expect(screen.getByTestId("duzen-vade")).toBeTruthy();
  });

  it("kapalı küme yok (eski fabrika): Finans kutusu bugünkü gibi görünür", async () => {
    render(<Dashboard />);
    expect(await screen.findByTestId("kpi-vade")).toBeTruthy();
  });
});
