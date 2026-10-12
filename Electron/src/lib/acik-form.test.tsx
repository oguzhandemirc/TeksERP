import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { resetOpenFormRegistryForTest, hasOpenForm, installFormListener } from "./acik-form";

/**
 * A6 — açık/yazılmış form kaydı: güncelleme kurulumunu bekletenin TEK kaynağı. Kayıt ortak diyalog/yan pencere
 * ilkellerinden beslenir (ekran başına tel yok); pencere dışında yalnız yazılmış `<form>` sayılır.
 */

beforeEach(() => {
  resetOpenFormRegistryForTest();
  installFormListener();
});
afterEach(() => cleanup());

function DiyalogFormu({ open, alan = true }: { open: boolean; alan?: boolean }) {
  return (
    <Dialog open={open}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Müşteri</DialogTitle>
        {alan ? <input aria-label="Ad" /> : <p>Silinsin mi?</p>}
      </DialogContent>
    </Dialog>
  );
}

describe("A6 açık form kaydı", () => {
  it("açık diyalog + düzenlenebilir alan → var; kapanınca → yok", () => {
    const { rerender } = render(<DiyalogFormu open />);
    expect(hasOpenForm()).toBe(true);
    rerender(<DiyalogFormu open={false} />);
    expect(hasOpenForm()).toBe(false);
  });

  it("alansız diyalog (onay penceresi) → yok", () => {
    render(<DiyalogFormu open alan={false} />);
    expect(hasOpenForm()).toBe(false);
  });

  it("devre dışı / salt-okunur alanlı diyalog → yok", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Künye</DialogTitle>
          <input aria-label="Kod" readOnly />
          <input aria-label="Tarih" disabled />
        </DialogContent>
      </Dialog>,
    );
    expect(hasOpenForm()).toBe(false);
  });

  it("açık yan pencere (sheet) + alan → var", () => {
    render(
      <Sheet open>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Süzgeç</SheetTitle>
          <textarea aria-label="Not" />
        </SheetContent>
      </Sheet>,
    );
    expect(hasOpenForm()).toBe(true);
  });

  it("sayfa formuna yazım → var; reset → yok", () => {
    const { getByLabelText, container } = render(
      <form>
        <input aria-label="Miktar" />
      </form>,
    );
    expect(hasOpenForm()).toBe(false); // yazılmadan sayılmaz
    fireEvent.input(getByLabelText("Miktar"), { target: { value: "12" } });
    expect(hasOpenForm()).toBe(true);
    act(() => {
      container.querySelector("form")!.reset();
    });
    expect(hasOpenForm()).toBe(false);
  });

  it("yazılmış form DOM'dan kalkınca → yok", () => {
    const { getByLabelText, unmount } = render(
      <form>
        <input aria-label="Miktar" />
      </form>,
    );
    fireEvent.change(getByLabelText("Miktar"), { target: { value: "3" } });
    expect(hasOpenForm()).toBe(true);
    unmount();
    expect(hasOpenForm()).toBe(false);
  });

  it("form dışı arama kutusuna yazım → yok", () => {
    const { getByLabelText } = render(<input aria-label="Ara" />);
    fireEvent.input(getByLabelText("Ara"), { target: { value: "top" } });
    expect(hasOpenForm()).toBe(false);
  });
});
