import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { FindBar } from "./FindBar";

// =============================================================================
// Sayfa içi arama çubuğu — davranış testleri
// =============================================================================
// En kritik iki şey:
//  1. Boş metinle `findInPage` ÇAĞRILMAMALI (Chromium hata fırlatır).
//  2. Yüklenmemiş liste satırı varken UYARI GÖRÜNMELİ — sessiz kalmak
//     kullanıcıya "kayıt sistemde yok" dedirtir; aramanın yapabileceği en
//     zararlı şey budur.
// =============================================================================

const start = vi.fn();
const stop = vi.fn();
let resultCb: ((r: { activeMatchOrdinal: number; matches: number }) => void) | null = null;

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
  resultCb = null;
  (window as unknown as { api: unknown }).api = {
    find: {
      start,
      stop,
      onResult: (cb: (r: { activeMatchOrdinal: number; matches: number }) => void) => {
        resultCb = cb;
        return () => {
          resultCb = null;
        };
      },
    },
  };
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("[data-find-unloaded]").forEach((el) => el.remove());
});

function markUnloadedRows(): void {
  const el = document.createElement("div");
  el.setAttribute("data-find-unloaded", "1");
  document.body.appendChild(el);
}

describe("FindBar", () => {
  it("kapalıyken hiç çizilmez", () => {
    const { container } = render(<FindBar open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("yazılan metni aratır", () => {
    render(<FindBar open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Aranacak metin"), { target: { value: "patos" } });
    expect(start).toHaveBeenCalledWith("patos", undefined);
  });

  it("metin silinince aramayı DURDURUR, boş metinle aratmaz", () => {
    render(<FindBar open onClose={() => {}} />);
    const input = screen.getByLabelText("Aranacak metin");
    fireEvent.change(input, { target: { value: "x" } });
    start.mockClear();
    fireEvent.change(input, { target: { value: "" } });
    // Chromium boş metinde findInPage'i reddediyor — hiç çağrılmamalı.
    expect(start).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("Enter sonraki, Shift+Enter önceki eşleşmeye gider", () => {
    render(<FindBar open onClose={() => {}} />);
    const input = screen.getByLabelText("Aranacak metin");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(start).toHaveBeenLastCalledWith("abc", { forward: true, findNext: true });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(start).toHaveBeenLastCalledWith("abc", { forward: false, findNext: true });
  });

  it("Escape çubuğu kapatır", () => {
    const onClose = vi.fn();
    render(<FindBar open onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("Aranacak metin"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("eşleşme sayacını gösterir", () => {
    render(<FindBar open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Aranacak metin"), { target: { value: "abc" } });
    expect(resultCb).not.toBeNull();
    // act() şart: olay React dışından (IPC köprüsünden) geliyor, state güncellemesi
    // aksi halde flush edilmez.
    act(() => resultCb?.({ activeMatchOrdinal: 3, matches: 17 }));
    expect(screen.getByText("3/17")).toBeTruthy();
  });

  it("yüklenmemiş satır YOKKEN uyarı çıkmaz", () => {
    render(<FindBar open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Aranacak metin"), { target: { value: "abc" } });
    expect(screen.queryByText(/Yalnız ekranda yüklü satırlarda arandı/)).toBeNull();
  });

  it("yüklenmemiş satır VARKEN uyarı çıkar (sessiz kalmaz)", () => {
    markUnloadedRows();
    render(<FindBar open onClose={() => {}} />);
    expect(screen.getByText(/Yalnız ekranda yüklü satırlarda arandı/)).toBeTruthy();
  });

  it("arama sırasında satır yüklenirse uyarı KAYBOLUR", () => {
    markUnloadedRows();
    render(<FindBar open onClose={() => {}} />);
    expect(screen.getByText(/Yalnız ekranda yüklü satırlarda arandı/)).toBeTruthy();
    // Kullanıcı kaydırdı, tüm satırlar yüklendi → işaret kalkar.
    document.querySelectorAll("[data-find-unloaded]").forEach((el) => el.remove());
    fireEvent.change(screen.getByLabelText("Aranacak metin"), { target: { value: "abc" } });
    expect(screen.queryByText(/Yalnız ekranda yüklü satırlarda arandı/)).toBeNull();
  });

  it("api yoksa (tarayıcıda/test) çökmez", () => {
    (window as unknown as { api: unknown }).api = undefined;
    expect(() => {
      render(<FindBar open onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText("Aranacak metin"), { target: { value: "x" } });
    }).not.toThrow();
  });
});
