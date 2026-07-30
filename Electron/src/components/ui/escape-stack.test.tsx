import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EscapeRegistrar } from "./escape-stack";

// =============================================================================
// Esc yığını sözleşmesi — 2026-07-30 regresyonunun bekçisi
// =============================================================================
// Dinleyici document'te CAPTURE fazında durur ve tükettiğinde preventDefault +
// stopPropagation çağırır → Radix onu HİÇ görmez. Bu güç, üç kuralı zorunlu kılar:
//   1. Yığına yalnız AÇIK dialog/sheet girer (kayıt Content'in İÇİNDE yapılır).
//      Regresyon: kayıt `DialogContent` gövdesindeydi ve `<DialogContent>` her zaman
//      render edilen `<Dialog>`'un çocuğu olduğu için KAPALI dialoglar da yığıya
//      giriyordu → yığın hiç boşalmıyor, Esc uygulamada HİÇBİR şeyi kapatmıyordu.
//   2. Üstte etkileşimli bir pop katmanı (menü/select/popover) varsa Esc ONUNDUR.
//      Regresyon: dialog içindeki dropdown'a basılan Esc TÜM dialog'u kapatıyordu.
//   3. En SON açılan (yığının tepesindeki) aktif kayıt kapanır — iç içe dialog/sheet.
// =============================================================================

const esc = () =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

/** Açık bir pop katmanı (rol ile) DOM'a ekler; temizleyiciyi döner. */
function openPopLayer(role: "menu" | "listbox" | "dialog" | "tooltip"): () => void {
  const el = document.createElement("div");
  el.setAttribute("data-ui-pop", "");
  el.setAttribute("data-state", "open");
  el.setAttribute("role", role);
  document.body.appendChild(el);
  return () => el.remove();
}

function openGlobalModal(): () => void {
  const el = document.createElement("div");
  el.setAttribute("data-global-modal", "");
  document.body.appendChild(el);
  return () => el.remove();
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Esc yığını", () => {
  it("kayıt MOUNT ömrüne bağlı — unmount sonrası Esc kimseyi kapatmaz", () => {
    const close = vi.fn();
    const { unmount } = render(<EscapeRegistrar close={close} isActive={() => true} />);
    esc();
    expect(close).toHaveBeenCalledTimes(1);

    unmount();
    esc();
    expect(close).toHaveBeenCalledTimes(1); // artmadı → yığından düştü
  });

  it("EN SON açılan aktif kayıt kapanır (iç içe dialog/sheet sırası)", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(<EscapeRegistrar close={outer} isActive={() => true} />);
    const innerR = render(<EscapeRegistrar close={inner} isActive={() => true} />);

    esc();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled(); // dıştaki HİÇ kapanmamalı

    innerR.unmount();
    esc();
    expect(outer).toHaveBeenCalledTimes(1); // iç kapanınca sıra dıştakine gelir
  });

  it("pasif sekmedeki kayıt atlanır, aktif olan kapanır (O5 davranışı)", () => {
    const background = vi.fn();
    const foreground = vi.fn();
    render(<EscapeRegistrar close={background} isActive={() => false} />);
    render(<EscapeRegistrar close={foreground} isActive={() => true} />);

    esc();
    expect(foreground).toHaveBeenCalledTimes(1);
    expect(background).not.toHaveBeenCalled();
  });

  it("hiçbir kayıt aktif değilse Esc tüketilmez (Radix'e kalır)", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => false} />);
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(close).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it.each(["menu", "listbox", "dialog"] as const)(
    "üstte açık %s pop katmanı varsa Esc ONUN — dialog kapanmaz",
    (role) => {
      const close = vi.fn();
      render(<EscapeRegistrar close={close} isActive={() => true} />);
      const closeLayer = openPopLayer(role);

      const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      document.dispatchEvent(e);
      expect(close, "dropdown açıkken dialog kapanmamalı").not.toHaveBeenCalled();
      expect(e.defaultPrevented, "olay Radix'e geçmeli").toBe(false);

      closeLayer(); // katman kapandı → sıra dialog'a gelir
      esc();
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it("TOOLTIP Esc'i çalmaz (fareyle açılan ipucu dialog'u kilitlemesin)", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => true} />);
    openPopLayer("tooltip");
    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("kapalı pop katmanı (data-state=closed) Esc'i engellemez", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => true} />);
    const el = document.createElement("div");
    el.setAttribute("data-ui-pop", "");
    el.setAttribute("data-state", "closed");
    el.setAttribute("role", "menu");
    document.body.appendChild(el);

    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("global bloklayan modal (login/komut paleti) açıkken yığına dokunulmaz", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => true} />);
    const closeModal = openGlobalModal();

    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(close).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);

    closeModal();
    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Escape DIŞINDAKİ tuşlar tüketilmez", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => true} />);
    const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(close).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("tüketince preventDefault + stopPropagation çağırır (Radix ikinci kez kapatmasın)", () => {
    const close = vi.fn();
    render(<EscapeRegistrar close={close} isActive={() => true} />);
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    const stopSpy = vi.spyOn(e, "stopPropagation");
    document.dispatchEvent(e);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
  });
});
