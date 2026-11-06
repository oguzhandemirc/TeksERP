import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { TabIdProvider } from "./tab-active";
import { getDirtyTabIds, installDirtyTabListener, resetDirtyTabsForTest, useDirtyTab } from "./dirty-tabs";

// KİRLİ SEKME KAYDI — iki besleyici: açık beyan (`useDirtyTab`) ve sekmeye portallanan pencereye yazma.

function Declares({ dirty }: { dirty: boolean }) {
  useDirtyTab(dirty);
  return null;
}

const ids = () => [...getDirtyTabIds()].sort();

beforeEach(() => {
  installDirtyTabListener();
  resetDirtyTabsForTest();
});
afterEach(() => {
  document.body.innerHTML = "";
  resetDirtyTabsForTest();
});

describe("useDirtyTab — açık beyan", () => {
  it("kirli iken sekme kayıtta; temize dönünce ve bileşen kalkınca düşer", () => {
    const view = render(
      <TabIdProvider value="t1">
        <Declares dirty />
      </TabIdProvider>,
    );
    expect(ids()).toEqual(["t1"]);
    view.rerender(
      <TabIdProvider value="t1">
        <Declares dirty={false} />
      </TabIdProvider>,
    );
    expect(ids()).toEqual([]);
    view.rerender(
      <TabIdProvider value="t1">
        <Declares dirty />
      </TabIdProvider>,
    );
    view.unmount();
    expect(ids()).toEqual([]);
  });

  it("sekme sistemi dışında (global diyalog) etkisiz", () => {
    render(<Declares dirty />);
    expect(ids()).toEqual([]);
  });
});

/** TabHost'un sekme katmanı + içine portallanmış ortak diyalog içeriği. */
function mountPane(attrs = ""): { pane: HTMLElement; input: HTMLInputElement } {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div data-tab-id="t2"><div data-ui-dialog="" ${attrs}><input id="alan" /></div></div>`,
  );
  const pane = document.querySelector<HTMLElement>("[data-ui-dialog]")!;
  return { pane, input: pane.querySelector("input")! };
}

describe("yazılmış pencere — DOM algısı", () => {
  it("sekmedeki diyaloğa yazınca kirli; diyalog kalkınca temiz", async () => {
    const { pane, input } = mountPane();
    expect(ids()).toEqual([]); // açık ama yazılmamış pencere sayılmaz
    fireEvent.input(input, { target: { value: "x" } });
    expect(ids()).toEqual(["t2"]);
    pane.remove();
    await waitFor(() => expect(ids()).toEqual([]));
  });

  it("seçici pencere (data-dirty-ignore) ve beyanlı form (data-dirty-managed) sayılmaz", () => {
    const { input } = mountPane('data-dirty-ignore=""');
    fireEvent.input(input, { target: { value: "ara" } });
    expect(ids()).toEqual([]);
    document.body.innerHTML = "";
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div data-tab-id="t3"><div data-ui-sheet=""><form data-dirty-managed=""><input /></form></div></div>`,
    );
    fireEvent.change(document.querySelector("input")!, { target: { value: "y" } });
    expect(ids()).toEqual([]);
  });

  it("pencere dışındaki alan (liste arama/süzgeç) sayılmaz", () => {
    document.body.insertAdjacentHTML("beforeend", `<div data-tab-id="t4"><input /></div>`);
    fireEvent.input(document.querySelector("input")!, { target: { value: "süz" } });
    expect(ids()).toEqual([]);
  });
});
