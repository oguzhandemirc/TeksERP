// D4-F3: barkod/QR elemanında kaynak seçici — Müşteri barkodu `source: CUSTOMER_CODE` yazar,
// Top barkodu anahtarı KALDIRIR (dokunulmamış şablonla bayt-aynı JSON); metin elemanında görünmez.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { LabelElement } from "@/types/label-canvas";
import { ScanSourceSection, scanSourcePatch } from "./ScanSourceSection";

const qr = { id: "q", type: "qr", x: 1, y: 1 } as LabelElement;

describe("ScanSourceSection", () => {
  it("varsayılan Top barkodu seçili; Müşteri barkodu tıklanınca CUSTOMER_CODE yazar", () => {
    const onChange = vi.fn();
    render(<ScanSourceSection element={qr} onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Top barkodu" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Müşteri barkodu" }));
    expect(onChange).toHaveBeenCalledWith({ source: "CUSTOMER_CODE" });
  });

  it("Top barkodu seçimi source anahtarını JSON'dan düşürür", () => {
    const merged = { ...qr, source: "CUSTOMER_CODE" as const, ...scanSourcePatch("ROLL") };
    expect(JSON.stringify(merged)).toBe(JSON.stringify(qr));
  });

  it("code128'de de görünür, metin elemanında görünmez", () => {
    const { rerender } = render(<ScanSourceSection element={{ id: "b", type: "code128", x: 1, y: 1 } as LabelElement} onChange={() => {}} />);
    expect(screen.getByText("Kaynak")).toBeTruthy();
    rerender(<ScanSourceSection element={{ id: "t", type: "text", x: 1, y: 1, text: "A" } as LabelElement} onChange={() => {}} />);
    expect(screen.queryByText("Kaynak")).toBeNull();
  });
});
