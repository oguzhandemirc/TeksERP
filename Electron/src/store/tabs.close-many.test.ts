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
  useTabsStore.setState({ tabs: ["a", "b", "c", "d"].map(tab), activeId: "c" });
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
