import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * ⭐ MASAÜSTÜ-YALNIZ EYLEM (bulut web paneli K3): webde düğme görünür-soluk, tıklama çocuğa
 * ULAŞMAZ (baskı/tartı mutasyonu koşmaz), kullanıcı "masaüstünden yapılır" bilgisini alır.
 * Electron'da çocuk AYNEN çizilir ve çalışır.
 */
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: toastInfo } }));

async function renderWith(electron: boolean, onClick: () => void) {
  vi.resetModules();
  vi.doMock("@/lib/runtime-env", () => ({ IS_ELECTRON: electron }));
  const { DesktopOnlyAction, DESKTOP_ONLY_MESSAGE } = await import("./DesktopOnlyAction");
  render(
    <DesktopOnlyAction>
      <button type="button" onClick={onClick}>Bas</button>
    </DesktopOnlyAction>,
  );
  return DESKTOP_ONLY_MESSAGE;
}

beforeEach(() => toastInfo.mockClear());

describe("DesktopOnlyAction", () => {
  it("⭐ web: soluk + aria-disabled; tıklama çocuğa ulaşmaz, bilgi mesajı çıkar", async () => {
    const onClick = vi.fn();
    const msg = await renderWith(false, onClick);
    expect(msg).toBe("Bu işlem masaüstü uygulamasından yapılır");
    const btn = screen.getByRole("button", { name: "Bas" });
    const wrap = btn.closest("[aria-disabled='true']");
    expect(wrap).not.toBeNull();
    expect(wrap?.className).toContain("opacity-50");
    expect(wrap?.getAttribute("title")).toBe(msg);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith(msg);
  });

  it("Electron: çocuk aynen çizilir, sarmalayıcı yok, tıklama çalışır", async () => {
    const onClick = vi.fn();
    await renderWith(true, onClick);
    const btn = screen.getByRole("button", { name: "Bas" });
    expect(btn.closest("[aria-disabled]")).toBeNull();
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });
});
