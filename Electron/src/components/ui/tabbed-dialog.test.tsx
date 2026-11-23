// Sekmeli modal kuralı (2026-11-24): çerçeve sabit yükseklik, yalnız panel kayar, forceMount'lu panel gizlenir ama
// DOM'da kalır (form durumu korunur); sekme şeridi dikey taşmaz (overflow-y-hidden, -mb-px yok).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogTitle } from "./dialog";
import { TabsTrigger } from "./tabs";
import { TabbedDialogContent, TabbedDialogFooter, TabbedDialogPanel, TabbedDialogTabList, TabbedDialogTabs } from "./tabbed-dialog";

function Host() {
  return (
    <Dialog open>
      <TabbedDialogContent className="max-w-3xl">
        <DialogTitle>Kart</DialogTitle>
        <TabbedDialogTabs defaultValue="a">
          <TabbedDialogTabList>
            <TabsTrigger value="a">Bilgiler</TabsTrigger>
            <TabsTrigger value="b">Diğer</TabsTrigger>
          </TabbedDialogTabList>
          <TabbedDialogPanel value="a" forceMount>
            <input aria-label="Ad" defaultValue="x" />
          </TabbedDialogPanel>
          <TabbedDialogPanel value="b">kısa</TabbedDialogPanel>
        </TabbedDialogTabs>
        <TabbedDialogFooter>
          <button type="button">Kaydet</button>
        </TabbedDialogFooter>
      </TabbedDialogContent>
    </Dialog>
  );
}

describe("TabbedDialog", () => {
  it("çerçeve sabit yükseklik + gizli taşma; panel tek kaydırıcı", () => {
    render(<Host />);
    const frame = document.querySelector("[data-tabbed-dialog]") as HTMLElement;
    const cls = frame.className.split(/\s+/);
    for (const c of ["flex", "flex-col", "overflow-hidden", "h-[min(88vh,60rem)]", "max-w-3xl"]) expect(cls).toContain(c);
    const panel = screen.getByLabelText("Ad").closest("[role=tabpanel]") as HTMLElement;
    expect(panel.className).toMatch(/overflow-y-auto/);
    expect(panel.className).toMatch(/flex-1/);
  });

  it("sekme değişince forceMount'lu panel DOM'da kalır (gizli), alt çubuk yerinde", async () => {
    render(<Host />);
    await userEvent.click(screen.getByRole("tab", { name: "Diğer" }));
    const input = screen.getByLabelText("Ad", { selector: "input" });
    expect(input).toBeInTheDocument();
    expect(input.closest("[role=tabpanel]")).toHaveAttribute("data-state", "inactive");
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeInTheDocument();
  });

  it("sekme şeridi dikey kaydırma çubuğu üretmez", () => {
    render(<Host />);
    const list = screen.getByRole("tablist");
    expect(list.className).toMatch(/overflow-y-hidden/);
    expect(list.className).not.toMatch(/(^|\s)border-b(\s|$)/);
    for (const t of screen.getAllByRole("tab")) expect(t.className).not.toMatch(/-mb-px/);
  });
});
