import { beforeEach, describe, expect, it, vi } from "vitest";

/** Toplu sekme kapatma: kapanan her sekmenin router'ı atılır, etkin sekme komşuya geçer. */
const disposeTabRouter = vi.fn();
vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter: vi.fn(() => true),
  disposeTabRouter,
}));

const { useTabsStore } = await import("./tabs");

const tab = (id: string) => ({ id, path: `/p/${id}`, title: id });
const ids = () => useTabsStore.getState().tabs.map((t) => t.id);
const active = () => useTabsStore.getState().activeId;

beforeEach(() => {
  useTabsStore.setState({ tabs: ["a", "b", "c", "d"].map(tab), activeId: "c", lastBulkClose: null });
  disposeTabRouter.mockClear();
});

describe("closeTabs", () => {
  it("diğerlerini kapat: yalnız çapa kalır ve etkin olur", () => {
    useTabsStore.getState().closeTabs("others", "b");
    expect(ids()).toEqual(["b"]);
    expect(active()).toBe("b");
    expect(disposeTabRouter.mock.calls.map((c) => c[0])).toEqual(["a", "c", "d"]);
  });

  it("sağdakileri kapat: etkin sağdaysa çapaya geçer", () => {
    useTabsStore.getState().closeTabs("right", "b");
    expect(ids()).toEqual(["a", "b"]);
    expect(active()).toBe("b");
  });

  it("soldakileri kapat: etkin kapanmadıysa yerinde kalır", () => {
    useTabsStore.getState().closeTabs("left", "c");
    expect(ids()).toEqual(["c", "d"]);
    expect(active()).toBe("c");
  });

  it("tümünü kapat: şerit boşalır, etkin null", () => {
    useTabsStore.getState().closeTabs("all");
    expect(ids()).toEqual([]);
    expect(active()).toBeNull();
    expect(disposeTabRouter).toHaveBeenCalledTimes(4);
  });

  it("geçersiz kapsam (en sağda sağdakiler) hiçbir şeyi değiştirmez", () => {
    const before = useTabsStore.getState().tabs;
    useTabsStore.getState().closeTabs("right", "d");
    expect(useTabsStore.getState().tabs).toBe(before);
    expect(disposeTabRouter).not.toHaveBeenCalled();
  });
});

describe("closeTab (aynı yoldan)", () => {
  it("etkin kapanınca önce sağ komşu, yoksa sol", () => {
    useTabsStore.getState().closeTab("c");
    expect(active()).toBe("d");
    useTabsStore.getState().closeTab("d");
    expect(active()).toBe("b");
    expect(ids()).toEqual(["a", "b"]);
  });

  it("etkin olmayan kapanınca etkin değişmez", () => {
    useTabsStore.getState().closeTab("a");
    expect(active()).toBe("c");
  });
});

describe("undoBulkClose — toplu kapatmayı geri al", () => {
  it("tümünü kapat → geri al: aynı sıra, aynı etkin sekme", () => {
    useTabsStore.getState().closeTabs("all");
    useTabsStore.getState().undoBulkClose();
    expect(ids()).toEqual(["a", "b", "c", "d"]);
    expect(active()).toBe("c");
    expect(useTabsStore.getState().lastBulkClose).toBeNull();
  });

  it("arada açılan sekme sona eklenir; arada ELLE kapatılan diriltilmez", () => {
    useTabsStore.getState().closeTabs("right", "b"); // c, d kapanır
    useTabsStore.setState({ tabs: [...useTabsStore.getState().tabs, tab("e")] });
    useTabsStore.getState().closeTab("a"); // tekli: anlık görüntüyü ezmez
    useTabsStore.getState().undoBulkClose();
    expect(ids()).toEqual(["b", "c", "d", "e"]);
    expect(active()).toBe("c");
  });

  it("tekli kapatma geri alınabilir toplu kayıt üretmez", () => {
    useTabsStore.getState().closeTab("a");
    expect(useTabsStore.getState().lastBulkClose).toBeNull();
  });

  it("çıkış (resetTabs) geri alma kaydını siler — sonraki kullanıcı öncekinin sekmelerini diriltemez", () => {
    useTabsStore.getState().closeTabs("all");
    useTabsStore.getState().resetTabs();
    useTabsStore.getState().undoBulkClose();
    expect(ids()).toEqual([]);
  });
});
