import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CodeNotes } from "./CodeNotes";

const NOTES = [
  { tone: "warning" as const, text: "Kod kipindesiniz — görsel düzenleme kısıtlı.", testId: "kip-uyarisi" },
  { tone: "info" as const, text: "Kalem tablosu bağı yok — Excel varsayılan kolonlarla.", testId: "excel-uyarisi" },
  { tone: "warning" as const, text: "Sayfa boyutu geçersiz." },
];

describe("CodeNotes — kod sekmesi uyarıları tek satır + daraltılabilir (KÜÇÜK-F / TZ 1280×720 bulgusu)", () => {
  it("daraltıkken ilk not KIRPILIR (truncate), kalan sayısı '+N', diğer metinler DOM'da yok", () => {
    render(<CodeNotes notes={NOTES} />);
    const kap = screen.getByTestId("kod-notlari");
    expect(kap.getAttribute("data-expanded")).toBe("0");
    expect(screen.getByTestId("kip-uyarisi").className).toContain("truncate");
    expect(screen.getByTestId("kod-notlari-fazla").textContent).toBe("+2");
    expect(screen.queryByText("Sayfa boyutu geçersiz.")).toBeNull();
    expect(screen.getByRole("button", { name: "Notları genişlet" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("genişletince üç not da tam metinle görünür; tekrar tıklayınca daralır", () => {
    render(<CodeNotes notes={NOTES} />);
    fireEvent.click(screen.getByRole("button", { name: "Notları genişlet" }));
    expect(screen.getByTestId("kod-notlari").getAttribute("data-expanded")).toBe("1");
    expect(screen.getByText("Sayfa boyutu geçersiz.")).toBeTruthy();
    expect(screen.getByTestId("excel-uyarisi")).toBeTruthy();
    expect(screen.queryByTestId("kod-notlari-fazla")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Notları daralt" }));
    expect(screen.getByTestId("kod-notlari").getAttribute("data-expanded")).toBe("0");
  });

  it("not yoksa hiç çizilmez; tek notta '+N' yok", () => {
    const { container, rerender } = render(<CodeNotes notes={[]} />);
    expect(container.querySelector("[data-testid=kod-notlari]")).toBeNull();
    rerender(<CodeNotes notes={[NOTES[0]!]} />);
    expect(screen.queryByTestId("kod-notlari-fazla")).toBeNull();
  });

  it("CodePanel notları yalnız CodeNotes ile basar (üst üste Callout geri gelmesin); editör kabı flex-1 + min-h-0", () => {
    const src = readFileSync(resolve(__dirname, "CodePanel.tsx"), "utf8");
    expect(/<CodeNotes\s+notes=/.test(src)).toBe(true);
    // Not alanında doğrudan Callout yok — tek giriş noktası CodeNotes.
    expect(/<Callout tone="(warning|info)">/.test(src)).toBe(false);
    expect(src).toContain('className="relative min-h-0 min-w-0 flex-1 p-2"');
  });
});
