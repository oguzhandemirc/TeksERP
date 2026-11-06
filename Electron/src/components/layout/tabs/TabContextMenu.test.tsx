import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter: vi.fn(() => true),
  disposeTabRouter: vi.fn(),
}));

const { useTabsStore } = await import("@/store/tabs");
const { TabContextMenu } = await import("./TabContextMenu");

const tab = (id: string) => ({ id, path: `/p/${id}`, title: id });

function openMenuOn(id: string) {
  render(
    <TabContextMenu tabId={id}>
      <div>çip {id}</div>
    </TabContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText(`çip ${id}`));
}

const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

beforeEach(() => {
  useTabsStore.setState({ tabs: ["a", "b", "c"].map(tab), activeId: "a" });
});

describe("TabContextMenu", () => {
  it("menü sırası ve kısayol ipuçları", () => {
    openMenuOn("b");
    const names = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(names).toEqual([
      "KapatCtrl/⌘+W",
      "Diğerlerini kapat",
      "Sağdakileri kapat",
      "Soldakileri kapat",
      "Tümünü kapatCtrl+Shift+W",
    ]);
  });

  it("en sağdaki sekmede 'Sağdakileri kapat' pasif, diğerleri etkin", () => {
    openMenuOn("c");
    expect(item("Sağdakileri kapat")).toHaveAttribute("data-disabled");
    expect(item("Soldakileri kapat")).not.toHaveAttribute("data-disabled");
  });

  it("seçim store'da kapsamlı kapatmayı yürütür", () => {
    openMenuOn("b");
    fireEvent.click(item("Diğerlerini kapat"));
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(["b"]);
    expect(useTabsStore.getState().activeId).toBe("b");
  });
});
