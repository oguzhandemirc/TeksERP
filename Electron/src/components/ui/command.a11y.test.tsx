import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommandDialog, CommandInput, CommandList } from "./command";

// Komut paleti (⌘K) her gezinmede açılır; başlıksız DialogContent Radix'te console.error
// basıyordu (e2e hata ağı, 2026-09-23). Başlık ve açıklama görünmez ama erişilebilir olmalı.
describe("CommandDialog erişilebilir adı", () => {
  afterEach(() => vi.restoreAllMocks());

  it("diyalog 'Komut paleti' adını ve açıklamasını taşır; Radix başlık/açıklama uyarısı basılmaz", () => {
    const hata = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const uyari = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <CommandDialog open onOpenChange={() => undefined}>
        <CommandInput placeholder="Ara" />
        <CommandList />
      </CommandDialog>,
    );
    const d = screen.getByRole("dialog", { name: "Komut paleti" });
    expect(d).toHaveAccessibleDescription(/Enter ile açın/);
    const radix = [...hata.mock.calls, ...uyari.mock.calls].map((c) => String(c[0])).filter((m) => /DialogTitle|Description/.test(m));
    expect(radix).toEqual([]);
  });
});
