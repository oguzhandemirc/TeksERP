// Armür ızgarası yön düğmesi yalnız ÇİZİMİ çevirir: alttan yukarıda ilk çizilen satır son atkıdır, ama
// hücrenin `data-pick`i veri satırıdır — basılan hücre aynı veri hücresidir (veri sırası korunur).
// Basılı sürükleme: down → enter (her yeni hücre) → pencere düzeyinde bırakma tek vuruş sonu.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LiftPlanGrid } from "./LiftPlanGrid";

// jsdom'da PointerEvent yok: fare alanları (button, shiftKey) taşınsın diye MouseEvent'ten türetilir.
if (typeof window.PointerEvent === "undefined") {
  Object.defineProperty(window, "PointerEvent", { value: class extends MouseEvent {}, configurable: true });
}

const PLAN = [[1, 0], [0, 0], [0, 1]];

function setup(direction: "bottom-up" | "top-down", canWrite = true) {
  const fns = { onCellDown: vi.fn(), onCellEnter: vi.fn(), onStrokeEnd: vi.fn(), onLenoToggle: vi.fn() };
  render(<LiftPlanGrid plan={PLAN} frames={2} rows={3} leno={new Set()} selector={[1, 2, 1]} selCount={2} canWrite={canWrite} direction={direction} {...fns} />);
  return fns;
}
const cell = (r: number, c: number) => document.querySelector<HTMLElement>(`[data-pick="${r}"][data-frame="${c}"]`)!;

describe("LiftPlanGrid yönü", () => {
  it("alttan yukarı: ilk çizilen satır 3. atkı, başlık en altta", () => {
    setup("bottom-up");
    const rows = screen.getAllByRole("row");
    expect(rows[0]!.getAttribute("data-row")).toBe("2");
    expect(rows.at(-1)!.querySelector("[role=columnheader]")).not.toBeNull();
  });
  it("yukarıdan aşağı: bugünkü sıra, başlık üstte", () => {
    setup("top-down");
    const rows = screen.getAllByRole("row");
    expect(rows[0]!.querySelector("[role=columnheader]")).not.toBeNull();
    expect(rows[1]!.getAttribute("data-row")).toBe("0");
  });
  it("basılan hücre yöne bakmadan veri satırını taşır", () => {
    const fns = setup("bottom-up");
    const firstDrawn = screen.getAllByRole("row")[0]!.querySelector<HTMLElement>("[data-pick]")!;
    fireEvent.pointerDown(firstDrawn, { button: 0 });
    expect(fns.onCellDown).toHaveBeenCalledWith({ r: 2, c: 0 }, false);
  });
});

describe("LiftPlanGrid sürükleme", () => {
  it("basılı sürükleme her hücrede enter, bırakınca tek vuruş sonu", () => {
    const fns = setup("top-down");
    fireEvent.pointerDown(cell(0, 0), { button: 0, shiftKey: true });
    expect(fns.onCellDown).toHaveBeenCalledWith({ r: 0, c: 0 }, true);
    fireEvent.pointerMove(cell(1, 1));
    expect(fns.onCellEnter).toHaveBeenCalledWith({ r: 1, c: 1 });
    fireEvent.pointerUp(window);
    expect(fns.onStrokeEnd).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(cell(2, 1));
    expect(fns.onCellEnter).toHaveBeenCalledTimes(1);
  });
  it("çerçeve başlığı döner işaretini çevirir; yazma izni yoksa hiçbir olay yok", () => {
    const fns = setup("top-down");
    fireEvent.pointerDown(screen.getAllByRole("columnheader")[1]!, { button: 0 });
    expect(fns.onLenoToggle).toHaveBeenCalledWith(2);
  });
  it("salt okunur ızgara basmayı yok sayar", () => {
    const fns = setup("top-down", false);
    fireEvent.pointerDown(cell(0, 0), { button: 0 });
    expect(fns.onCellDown).not.toHaveBeenCalled();
  });
});
