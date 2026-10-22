// Sekme bekçisi: 5 sekme yolu sabit (bildirim rotaları, safeRoute ve bildirim-sw.js bunlara bağlı); izinsiz sekme
// çizilmez (href:null); "Diğer" her hesapta; native-tabs (beta) kullanılmaz; "Diğer" yalnız izinli bölümleri listeler.
import { render, screen } from "@testing-library/react-native";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";

const mockSession = { permissions: [] as string[], facility: null as unknown, offline: false, offlineSince: null as string | null, facilities: [] as unknown[], switchError: null as string | null };
const mockScreens: { name: string; options: { href?: null; title: string; tabBarButtonTestID?: string } }[] = [];
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => {
  const Tabs = ({ children }: { children: ReactNode }) => children;
  Tabs.Screen = (p: { name: string; options: never }) => {
    mockScreens.push({ name: p.name, options: p.options });
    return null;
  };
  return { Tabs, useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn(), navigate: jest.fn() }), usePathname: () => "/diger" };
});

const { TABS, visibleTabs } = require("../src/ui/tabs") as typeof import("../src/ui/tabs");
const TabsLayout = (require("../app/(app)/(tabs)/_layout") as typeof import("../app/(app)/(tabs)/_layout")).default;
const More = (require("../app/(app)/(tabs)/diger") as typeof import("../app/(app)/(tabs)/diger")).default;

const ROOT = join(__dirname, "..");

function renderTabs(perms: string[]) {
  mockSession.permissions = perms;
  mockScreens.length = 0;
  render(<TabsLayout />);
  return Object.fromEntries(mockScreens.map((s) => [s.name, s.options]));
}

describe("sekme yolları sabit", () => {
  it("5 sekme, sıra ve yol", () => {
    expect(TABS.map((t) => t.route)).toEqual(["/pano", "/uretim", "/siparisler", "/finans", "/diger"]);
    expect(TABS.map((t) => t.title)).toEqual(["Pano", "Üretim", "Siparişler", "Finans", "Diğer"]);
  });
  it("her sekmenin dosyası (tabs) grubunda; eski yerinde kopya yok (URL tek)", () => {
    const tabs = join(ROOT, "app/(app)/(tabs)");
    for (const f of ["pano.tsx", "uretim.tsx", "finans.tsx", "diger.tsx", "siparisler/index.tsx", "siparisler/yeni.tsx"]) expect(existsSync(join(tabs, f))).toBe(true);
    for (const f of ["pano.tsx", "uretim.tsx", "finans.tsx", "diger.tsx", "siparisler"]) expect(existsSync(join(ROOT, "app/(app)", f))).toBe(false);
  });
  it("native-tabs (beta) hiçbir yerde içe aktarılmaz", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const hits = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "src"))].filter((f) => /expo-router\/(unstable-)?native-tabs/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("izinli sekmeler", () => {
  it("yalnız oturum izni: Pano + Diğer; ötekiler href:null", () => {
    const o = renderTabs(["bulut:oturum"]);
    expect(Object.keys(o)).toEqual(["pano", "uretim", "siparisler", "finans", "diger"]);
    expect(o.pano!.href).toBeUndefined();
    expect(o.diger!.href).toBeUndefined();
    expect(o.uretim!.href).toBeNull();
    expect(o.siparisler!.href).toBeNull();
    expect(o.finans!.href).toBeNull();
    expect(visibleTabs(["bulut:oturum"]).map((t) => t.name)).toEqual(["pano", "diger"]);
  });
  it("sipariş + kasa izni: Siparişler ve Finans açılır, Üretim kapalı kalır", () => {
    const o = renderTabs(["bulut:siparis:oku", "bulut:kasa:oku"]);
    expect(o.siparisler!.href).toBeUndefined();
    expect(o.finans!.href).toBeUndefined();
    expect(o.uretim!.href).toBeNull();
    expect(o.pano!.tabBarButtonTestID).toBe("tab-pano");
  });
});

describe("Diğer listesi", () => {
  it("izinsiz bölüm çizilmez; profil ve bildirimler her hesapta", () => {
    mockSession.permissions = ["bulut:oturum", "bulut:cari:oku"];
    render(<More />);
    expect(screen.getByTestId("menu-cariler")).toBeTruthy();
    expect(screen.getByTestId("menu-profil")).toBeTruthy();
    expect(screen.getByTestId("menu-bildirimler")).toBeTruthy();
    expect(screen.queryByTestId("menu-hesaplar")).toBeNull();
    expect(screen.queryByTestId("menu-raporlar")).toBeNull();
    expect(screen.queryByTestId("menu-gelen-kutusu")).toBeNull();
    expect(screen.queryByTestId("grup-Eylem")).toBeNull();
  });
});
