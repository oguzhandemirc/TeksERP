import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// KİRLİ SEKME KAPISI — her kapatma yolu (X, toplu, Ctrl+W, Ctrl+Shift+W, sağ tık) ve elle çıkış
// kaydedilmemiş değişiklik varken onay sorar; temiz sekmede eskisi gibi hemen kapanır.

vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter: vi.fn(() => true),
  disposeTabRouter: vi.fn(),
}));

const { useTabsStore } = await import("@/store/tabs");
const { TabIdProvider } = await import("./tab-active");
const { useDirtyTab, resetDirtyTabsForTest } = await import("./dirty-tabs");
const { requestCloseTabs, requestLogout, useDirtyConfirmStore, dirtyConfirmText } = await import("./dirty-close-guard");
const { DirtyTabsConfirm } = await import("./DirtyTabsConfirm");
const { TabContextMenu } = await import("./TabContextMenu");
const { TabStrip } = await import("./TabStrip");
const { useTabShortcuts } = await import("@/hooks/useTabShortcuts");

const tab = (id: string, title: string) => ({ id, path: `/p/${id}`, title });
const ids = () => useTabsStore.getState().tabs.map((t) => t.id);
const pending = () => useDirtyConfirmStore.getState().pending;

/** Diyaloğun köşe X'i de "Kapat" adını taşır; onay düğmesi görünür metniyle seçilir. */
const confirmButton = (label: string) =>
  screen.getAllByRole("button", { name: label }).find((b) => b.textContent === label)!;

function Dirty() {
  useDirtyTab(true);
  return null;
}
function Shortcuts() {
  useTabShortcuts();
  return null;
}

/** b ("Sipariş") kirli; a ve c temiz. */
function setup() {
  return render(
    <>
      <TabIdProvider value="b">
        <Dirty />
      </TabIdProvider>
      <Shortcuts />
      <DirtyTabsConfirm />
    </>,
  );
}

beforeEach(() => {
  resetDirtyTabsForTest();
  useDirtyConfirmStore.setState({ pending: null });
  useTabsStore.setState({
    tabs: [tab("a", "Anasayfa"), tab("b", "Sipariş"), tab("c", "Müşteriler")],
    activeId: "b",
    lastBulkClose: null,
  });
});
afterEach(() => resetDirtyTabsForTest());

describe("tek sekme", () => {
  it("temiz sekme sorulmadan kapanır", () => {
    setup();
    act(() => requestCloseTabs("self", "a"));
    expect(pending()).toBeNull();
    expect(ids()).toEqual(["b", "c"]);
  });

  it("kirli sekme: onay çıkar, Vazgeç → açık kalır, Kapat → kapanır", async () => {
    setup();
    act(() => requestCloseTabs("self", "b"));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(screen.getByText(/1 sekmede kaydedilmemiş değişiklik var: • Sipariş Yine de/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(pending()).toBeNull();
    expect(ids()).toEqual(["a", "b", "c"]);

    act(() => requestCloseTabs("self", "b"));
    fireEvent.click(confirmButton("Kapat"));
    expect(ids()).toEqual(["a", "c"]);
  });

  it("Ctrl+W (etkin kirli sekme) onay sorar", () => {
    setup();
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(pending()?.titles).toEqual(["Sipariş"]);
    expect(ids()).toHaveLength(3);
  });

  it("şerit X düğmesi ve kirli işaret", () => {
    setup();
    render(<TabStrip />);
    const close = screen.getByRole("button", { name: "Sipariş sekmesini kapat (kaydedilmemiş değişiklik var)" });
    expect(close.hasAttribute("data-dirty")).toBe(true);
    expect(screen.getByRole("button", { name: "Anasayfa sekmesini kapat" }).hasAttribute("data-dirty")).toBe(false);
    fireEvent.click(close);
    expect(pending()?.kind).toBe("close");
  });
});

describe("toplu kapatma", () => {
  it("Ctrl+Shift+W: kirli varsa sorar; Kapat → hepsi kapanır, Geri al anlık görüntüsü kalır", () => {
    setup();
    fireEvent.keyDown(window, { key: "W", ctrlKey: true, shiftKey: true });
    expect(pending()?.titles).toEqual(["Sipariş"]);
    expect(ids()).toHaveLength(3);
    act(() => useDirtyConfirmStore.getState().confirm());
    expect(ids()).toEqual([]);
    expect(useTabsStore.getState().lastBulkClose?.closedIds).toEqual(["a", "b", "c"]);
  });

  it("onay açıkken ikinci kısayol yeni soru açmaz", () => {
    setup();
    act(() => requestCloseTabs("self", "b"));
    const first = pending();
    fireEvent.keyDown(window, { key: "W", ctrlKey: true, shiftKey: true });
    expect(pending()).toBe(first);
  });

  it("kirli sekme kapsam dışındaysa sormaz (sağdakileri kapat)", () => {
    setup();
    act(() => requestCloseTabs("right", "b"));
    expect(pending()).toBeNull();
    expect(ids()).toEqual(["a", "b"]);
  });

  it("sağ tık 'Diğerlerini kapat' kirli sekmeyi kapsıyorsa sorar", async () => {
    setup();
    render(
      <TabContextMenu tabId="a">
        <div>çip a</div>
      </TabContextMenu>,
    );
    fireEvent.contextMenu(screen.getByText("çip a"));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Diğerlerini kapat/ }));
    await waitFor(() => expect(pending()?.titles).toEqual(["Sipariş"]));
    expect(ids()).toHaveLength(3);
  });
});

describe("çıkış", () => {
  it("temizken hemen çıkar", () => {
    useTabsStore.setState({ tabs: [tab("a", "Anasayfa")], activeId: "a" });
    const run = vi.fn();
    requestLogout(run);
    expect(run).toHaveBeenCalledOnce();
  });

  it("kirli sekme varken sorar; Vazgeç → çıkılmaz, Çıkış yap → çıkılır", () => {
    setup();
    const run = vi.fn();
    act(() => requestLogout(run));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByText(/Yine de çıkılsın mı\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(run).not.toHaveBeenCalled();
    act(() => requestLogout(run));
    fireEvent.click(confirmButton("Çıkış yap"));
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("pencere kapanışı (beforeunload)", () => {
  it("kirli sekme varken yüklemeyi bırakmayı engeller, temizken engellemez", () => {
    const view = setup();
    const dirtyEvt = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvt);
    expect(dirtyEvt.defaultPrevented).toBe(true);
    view.unmount();
    render(<DirtyTabsConfirm />);
    const cleanEvt = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvt);
    expect(cleanEvt.defaultPrevented).toBe(false);
  });
});

it("onay metni: sayı + adlar", () => {
  expect(dirtyConfirmText({ kind: "close", titles: ["A", "B"] })).toMatch(/^2 sekmede kaydedilmemiş değişiklik var:\n• A\n• B\n\nYine de kapatılsın mı\?/);
});
