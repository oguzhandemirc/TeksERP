import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TypeToConfirm, matchesConfirmation } from "./TypeToConfirm";

describe("matchesConfirmation", () => {
  it("birebir eşleşmede true", () => {
    expect(matchesConfirmation("TeksErpDb", "TeksErpDb")).toBe(true);
  });

  it("baştaki/sondaki boşluğu kırpar", () => {
    expect(matchesConfirmation("  TeksErpDb  ", "TeksErpDb")).toBe(true);
  });

  it("BÜYÜK-KÜÇÜK HARF DUYARLI — PG'de tırnaklı adlar farklı veritabanlarıdır", () => {
    expect(matchesConfirmation("tekserpdb", "TeksErpDb")).toBe(false);
    expect(matchesConfirmation("TEKSERPDB", "TeksErpDb")).toBe(false);
  });

  it("kısmi/yakın-ıska eşleşmez", () => {
    expect(matchesConfirmation("TeksErpD", "TeksErpDb")).toBe(false);
    expect(matchesConfirmation("TeksErpDb2", "TeksErpDb")).toBe(false);
  });

  it("boş beklenen metin ASLA eşleşmez (kapı açık kalmasın)", () => {
    expect(matchesConfirmation("", "")).toBe(false);
    expect(matchesConfirmation("   ", "  ")).toBe(false);
  });
});

function Harness({ allowPaste }: { allowPaste?: boolean }) {
  const [v, setV] = useState("");
  return (
    <TypeToConfirm expected="TeksErpDb" value={v} onChange={setV} allowPaste={allowPaste} />
  );
}

describe("TypeToConfirm", () => {
  it("yanlış metinde uyarı gösterir", async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByRole("textbox"), "yanlis");
    expect(screen.getByText(/eşleşmiyor/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("doğru metinde uyarı kalkar", async () => {
    renderWithProviders(<Harness />);
    await userEvent.type(screen.getByRole("textbox"), "TeksErpDb");
    expect(screen.queryByText(/eşleşmiyor/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "false");
  });

  it("varsayılan olarak YAPIŞTIRMA engellenir", () => {
    renderWithProviders(<Harness />);
    const input = screen.getByRole("textbox");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    fireEvent(input, ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByText(/Yapıştırma kapalı/i)).toBeInTheDocument();
  });

  it("allowPaste ile yapıştırma serbest bırakılır", () => {
    renderWithProviders(<Harness allowPaste />);
    const input = screen.getByRole("textbox");
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    fireEvent(input, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByText(/Yapıştırma kapalı/i)).not.toBeInTheDocument();
  });

  it("onChange her tuşta parent'a bildirilir (kontrollü bileşen)", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <TypeToConfirm expected="ABC" value="" onChange={onChange} />,
    );
    await userEvent.type(screen.getByRole("textbox"), "A");
    expect(onChange).toHaveBeenCalledWith("A");
  });
});
