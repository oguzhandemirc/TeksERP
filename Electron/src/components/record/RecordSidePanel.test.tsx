import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecordSidePanel } from "./RecordSidePanel";
import { neighborId, isOutsidePanel, isTypingTarget } from "./record-nav";
import { RecordFacts, initialsOf } from "./RecordBits";

function setup(over: Partial<Parameters<typeof RecordSidePanel>[0]> = {}) {
  const props = { label: "Cari: A", onClose: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), onOpenFull: vi.fn(), header: <b>A</b>, ...over };
  render(
    <div>
      <input aria-label="ara" />
      <table><tbody><tr data-record-row=""><td>satır</td></tr></tbody></table>
      <p>dışarı</p>
      <RecordSidePanel {...props}><button type="button">iç düğme</button></RecordSidePanel>
    </div>,
  );
  return props;
}

describe("RecordSidePanel", () => {
  it("Esc paneli kapatır", () => {
    const p = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("↓ sonraki, ↑ önceki kayda gider; yazı alanındaki ok tuşu panelin değil", () => {
    const p = setup();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(p.onNext).toHaveBeenCalledTimes(1);
    expect(p.onPrev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("ara"), { key: "ArrowDown" });
    expect(p.onNext).toHaveBeenCalledTimes(1);
  });

  it("dışarı tık kapatır; panel içi ve liste satırı kapatmaz", () => {
    const p = setup();
    fireEvent.pointerDown(screen.getByText("iç düğme"), { button: 0 });
    fireEvent.pointerDown(screen.getByText("satır"), { button: 0 });
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText("dışarı"), { button: 0 });
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it("tam sayfa düğmesi; komşu yoksa ok düğmesi pasif", () => {
    const p = setup({ onPrev: null });
    fireEvent.click(screen.getByRole("button", { name: "Tam sayfa aç" }));
    expect(p.onOpenFull).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Önceki kayıt" })).toBeDisabled();
  });

  it("tam sayfa verilmezse düğme yok", () => {
    setup({ onOpenFull: null });
    expect(screen.queryByRole("button", { name: "Tam sayfa aç" })).toBeNull();
  });
});

describe("record-nav", () => {
  it("komşu kayıt uçta durur", () => {
    expect(neighborId(["a", "b", "c"], "b", 1)).toBe("c");
    expect(neighborId(["a", "b", "c"], "c", 1)).toBeNull();
    expect(neighborId(["a", "b"], "a", -1)).toBeNull();
    expect(neighborId(["a"], "x", 1)).toBeNull();
  });
  it("yazı alanı ve diyalog ayrımı", () => {
    const i = document.createElement("input");
    expect(isTypingTarget(i)).toBe(true);
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    const inner = document.createElement("span");
    d.appendChild(inner);
    document.body.appendChild(d);
    expect(isOutsidePanel(inner)).toBe(false);
    d.remove();
  });
});

describe("RecordBits", () => {
  it("boş değerli özet satırı çizilmez; hepsi boşsa hiç", () => {
    const { container, rerender } = render(<RecordFacts facts={[{ key: "a", label: "Telefon", value: "0212" }, { key: "b", label: "E-posta", value: null }]} />);
    expect(screen.getByText("Telefon")).toBeInTheDocument();
    expect(screen.queryByText("E-posta")).toBeNull();
    rerender(<RecordFacts facts={[{ key: "b", label: "E-posta", value: "" }]} />);
    expect(container.querySelector("dl")).toBeNull();
  });
  it("baş harfler Türkçe büyük", () => {
    expect(initialsOf("ilke tekstil")).toBe("İT");
    expect(initialsOf("ÖRNEK (BURSA)")).toBe("ÖB");
  });
});
