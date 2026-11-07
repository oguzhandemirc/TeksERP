// @vitest-environment jsdom
// =============================================================================
// Bekçi: HER YENİ OTURUM TEK SEKME ANASAYFA İLE BAŞLAR (kullanıcı kararı 2026-11-07)
// =============================================================================
// Yeni oturum = çıkış→giriş · 401/oturum düşmesi→giriş · uygulamayı kapatıp açma.
// Hepsinde önceki sekmeler (başlıklarında müşteri/sipariş adları) gelmez, hash'te
// kalan eski yol açılmaz. F5 oturum içinde sekmeleri korur (hidrasyon sınır değil).
//
// Kurulum ayrıntıları (ölçüldü): bu ortamda Web Storage YOK → stub import'lardan
// önce (`vi.hoisted`). `tab-routers` mocklanır: gerçek registry tüm sayfa ağacını
// yükler, takım koşumunda zaman aşımına düşer.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.hoisted(() => {
  const kur = (ad: "localStorage" | "sessionStorage") => {
    const kutu = new Map<string, string>();
    (globalThis as unknown as Record<string, Storage>)[ad] = {
      getItem: (k: string) => kutu.get(k) ?? null,
      setItem: (k: string, v: string) => void kutu.set(k, v),
      removeItem: (k: string) => void kutu.delete(k),
      clear: () => kutu.clear(),
      key: () => null,
      get length() {
        return kutu.size;
      },
    } as Storage;
  };
  kur("localStorage");
  kur("sessionStorage");
});

vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter: vi.fn(() => true),
  disposeTabRouter: vi.fn(),
}));
vi.mock("@/components/layout/tabs/TabStrip", () => ({ TabStrip: () => null }));
vi.mock("@/components/layout/tabs/TabRouter", () => ({ TabRouter: () => null }));
vi.mock("@/components/layout/tabs/DirtyTabsConfirm", () => ({ DirtyTabsConfirm: () => null }));
vi.mock("@/lib/secure-token", () => ({
  tokenStore: { get: vi.fn(async () => null), clear: vi.fn(async () => undefined), set: vi.fn() },
}));
vi.mock("@/lib/runtime-env", () => ({ IS_ELECTRON: true }));

const { useTabsStore, bindTabsToSession } = await import("./tabs");
const { useAuthStore } = await import("./auth");
const { TabHost } = await import("@/components/layout/tabs/TabHost");
const { TABS_STORAGE_KEY, isPageReload, purgeTabsOnFreshLaunch } = await import("./tabs-storage");

const kullanici = (userId: string) =>
  ({ userId, username: userId, permissions: ["*"] }) as unknown as NonNullable<
    ReturnType<typeof useAuthStore.getState>["user"]
  >;

function birkacSekmeAc() {
  useTabsStore.getState().openTab("/orders");
  useTabsStore.getState().openTab("/customers", { forceNew: true });
  expect(useTabsStore.getState().tabs.length).toBe(2); // körlük zemini
}

/** Giriş sonrası kabuk bağlanır → TabHost ilk açılış etkisi koşar. */
function kabuguBagla() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TabHost />
    </QueryClientProvider>,
  );
  return useTabsStore.getState().tabs.map((t) => t.path);
}

async function kaynak(goreli: string): Promise<string> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  return fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), goreli), "utf8");
}

let unbind: () => void = () => undefined;
beforeEach(() => {
  useTabsStore.getState().resetTabs();
  useAuthStore.setState({ user: null, isHydrated: true });
  window.location.hash = "";
  unbind = bindTabsToSession(useAuthStore);
});
afterEach(() => {
  unbind();
  cleanup();
});

describe("yeni oturum tek sekme Anasayfa", () => {
  it("⭐ çıkış → giriş: önceki sekmeler gelmez, tek sekme '/'", async () => {
    useAuthStore.getState().setUser(kullanici("a"));
    birkacSekmeAc();
    await useAuthStore.getState().logout();
    expect(useTabsStore.getState().tabs).toEqual([]);
    useAuthStore.getState().setUser(kullanici("b"));
    expect(kabuguBagla()).toEqual(["/"]);
  });

  it("⭐ 401 / oturum düşmesi (setUser(null)) → giriş: tek sekme '/'", () => {
    useAuthStore.getState().setUser(kullanici("a"));
    birkacSekmeAc();
    useAuthStore.getState().setUser(null); // apiClient.endClientSession'ın yaptığı
    expect(useTabsStore.getState().tabs).toEqual([]);
    useAuthStore.getState().setUser(kullanici("a"));
    expect(kabuguBagla()).toEqual(["/"]);
  });

  it("⭐ giriş anı da sınırdır: kapanıştan kalan defter girişte boşalır", () => {
    useTabsStore.setState({ tabs: [{ id: "eski", path: "/orders", title: "Siparişler" }], activeId: "eski" });
    useAuthStore.getState().setUser(kullanici("b"));
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it("⭐ hash'te eski yol varken yeni oturum '/' açar", () => {
    window.location.hash = "#/orders";
    useAuthStore.getState().setUser(kullanici("a"));
    expect(kabuguBagla()).toEqual(["/"]);
  });

  it("F5 (hidrasyon) sınır değildir: sekmeler korunur", () => {
    useAuthStore.setState({ isHydrated: false });
    birkacSekmeAc();
    useAuthStore.getState().setUser(kullanici("a"));
    expect(useTabsStore.getState().tabs.length).toBe(2);
    expect(kabuguBagla()).toEqual(["/orders", "/customers"]);
  });

  it("aynı kimliğin token tazelemesi sekmeleri kapatmaz", () => {
    useAuthStore.getState().setUser(kullanici("a"));
    birkacSekmeAc();
    useAuthStore.getState().setUser(kullanici("a"));
    expect(useTabsStore.getState().tabs.length).toBe(2);
  });

  it("apiClient 401 çıkışı setUser(null) yolundan geçer — kaynak sözleşmesi", async () => {
    const src = await kaynak("../services/apiClient.ts");
    // Adnan hattında 401 dalı apiClient interceptor'ında satır içidir (endClientSession yok).
    const govde = src.slice(src.indexOf("if (status === 401)"));
    expect(govde.slice(0, 1200)).toMatch(/setUser\(null\)/);
  });

  it("App sınır aboneliğini bağlar — kaynak sözleşmesi", async () => {
    const src = await kaynak("../App.tsx");
    expect(src).toMatch(/bindTabsToSession\(useAuthStore\)/);
  });
});

describe("uygulamayı kapatıp açma", () => {
  const nav = (type: string) => ({ getEntriesByType: () => [{ type }] }) as unknown as Performance;
  const eski = JSON.stringify({ state: { tabs: [{ id: "x", path: "/orders", title: "S" }], activeId: "x" }, version: 0 });

  it("⭐ yeni açılışta kalıcı eski sekmeler silinir (oturum geçerli olsa bile)", () => {
    sessionStorage.setItem(TABS_STORAGE_KEY, eski);
    localStorage.setItem(TABS_STORAGE_KEY, eski);
    purgeTabsOnFreshLaunch(nav("navigate"));
    expect(sessionStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
  });

  it("⭐ store yeni açılışta eski defterle DOĞMAZ (modül yeniden yüklenir)", async () => {
    sessionStorage.setItem(TABS_STORAGE_KEY, eski);
    vi.resetModules();
    const taze = await import("./tabs");
    expect(taze.useTabsStore.getState().tabs).toEqual([]);
  });

  it("F5 (reload) defteri korur — oturum içi yenileme kararı", () => {
    sessionStorage.setItem(TABS_STORAGE_KEY, eski);
    purgeTabsOnFreshLaunch(nav("reload"));
    expect(sessionStorage.getItem(TABS_STORAGE_KEY)).toBe(eski);
  });

  it("gezinme türü ölçülemezse sıfırlama yönüne düşer", () => {
    expect(isPageReload(undefined)).toBe(false);
    expect(isPageReload({ getEntriesByType: () => [] } as unknown as Performance)).toBe(false);
  });

  it("defter localStorage'a değil sessionStorage'a yazılır", () => {
    localStorage.removeItem(TABS_STORAGE_KEY);
    useTabsStore.getState().openTab("/orders");
    expect(localStorage.getItem(TABS_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(TABS_STORAGE_KEY) as string).state.tabs).toHaveLength(1);
  });
});
