import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sekme defteri ↔ router senkronu + "geri" (2026-08-22).
 *
 * `tab-routers` mocklanır: gerçek registry tüm sayfa ağacını (content-routes)
 * import eder — bu bekçinin sorusu router'ın kendisi değil, STORE'un ona ne
 * dediği ve defteri nasıl güncellediğidir.
 */
const goBackTabRouter = vi.fn(() => true);
vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter,
  disposeTabRouter: vi.fn(),
}));

const { useTabsStore } = await import("./tabs");

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null });
  goBackTabRouter.mockClear();
});

describe("backActive", () => {
  it("aktif sekmenin router'ında geri çağırır", () => {
    useTabsStore.getState().openTab("/operations/rolls");
    const activeId = useTabsStore.getState().activeId;
    useTabsStore.getState().backActive();
    expect(goBackTabRouter).toHaveBeenCalledWith(activeId);
  });

  it("açık sekme yokken sessizdir (çökmez)", () => {
    useTabsStore.getState().backActive();
    expect(goBackTabRouter).not.toHaveBeenCalled();
  });
});

describe("syncTabLocation", () => {
  it("router kendi içinde gezindiğinde sekmenin yolu ve başlığı tazelenir", () => {
    useTabsStore.getState().openTab("/operations/rolls");
    const id = useTabsStore.getState().activeId!;
    const before = useTabsStore.getState().tabs[0]!;

    useTabsStore.getState().syncTabLocation(id, "/operations/orders");

    const after = useTabsStore.getState().tabs[0]!;
    expect(after.path).toBe("/operations/orders");
    expect(after.title).not.toBe(before.title);
  });

  it("sorgu dizesi yolu değiştirmez — özel başlık korunur", () => {
    useTabsStore.getState().openTab("/operations/rolls");
    const id = useTabsStore.getState().activeId!;
    useTabsStore.getState().updateTabTitle(id, "Envanter · özel");

    useTabsStore.getState().syncTabLocation(id, "/operations/rolls");

    expect(useTabsStore.getState().tabs[0]!.title).toBe("Envanter · özel");
  });
});
