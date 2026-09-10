import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrintPageSizeToggle, readDocPageSize } from "./PrintPageSizeToggle";

describe("readDocPageSize — belgenin kendi boyutu @page'ten okunur", () => {
  it("A5 belgeyi tanır", () => {
    expect(readDocPageSize("<style>@page { size: A5; margin: 9mm; }</style>")).toBe("A5");
  });
  it("A4 belgeyi tanır", () => {
    expect(readDocPageSize("@page { size: A4; margin: 9mm 9mm 9mm 9mm; }")).toBe("A4");
  });
  it("HTML yoksa/kural yoksa undefined — düğme boyut UYDURMAZ", () => {
    expect(readDocPageSize(null)).toBeUndefined();
    expect(readDocPageSize("<p>belge</p>")).toBeUndefined();
  });
});

describe("PrintPageSizeToggle", () => {
  it("ezme yokken belgenin KENDİ boyutu seçili görünür", () => {
    render(
      <PrintPageSizeToggle value={undefined} onChange={vi.fn()} docPageSize="A5" />,
    );
    expect(screen.getByRole("button", { name: "A5" }).className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "A4" }).className).not.toContain("bg-primary");
  });

  it("ezme varsa ezme seçili görünür", () => {
    render(<PrintPageSizeToggle value="A4" onChange={vi.fn()} docPageSize="A5" />);
    expect(screen.getByRole("button", { name: "A4" }).className).toContain("bg-primary");
  });

  it("diğer boyuta basmak EZME kurar", async () => {
    const onChange = vi.fn();
    render(<PrintPageSizeToggle value={undefined} onChange={onChange} docPageSize="A5" />);
    await userEvent.click(screen.getByRole("button", { name: "A4" }));
    expect(onChange).toHaveBeenCalledWith("A4");
  });

  // ⚠️ EN ÖNEMLİ: belgenin kendi boyutuna basmak ezmeyi KALDIRIR (`undefined`),
  // "A4'ü seçtim ama ayar zaten A4'tü" durumu URL'e gereksiz parametre eklemez
  // ve backend snapshot kopyası hiç kurulmaz.
  it("belgenin kendi boyutuna basmak ezmeyi KALDIRIR", async () => {
    const onChange = vi.fn();
    render(<PrintPageSizeToggle value="A4" onChange={onChange} docPageSize="A5" />);
    await userEvent.click(screen.getByRole("button", { name: "A5" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("disabled iken tıklama geçmez", async () => {
    const onChange = vi.fn();
    render(
      <PrintPageSizeToggle value={undefined} onChange={onChange} docPageSize="A4" disabled />,
    );
    await userEvent.click(screen.getByRole("button", { name: "A5" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
