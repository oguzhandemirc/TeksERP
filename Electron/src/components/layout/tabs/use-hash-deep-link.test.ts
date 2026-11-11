import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { deepLinkTarget, useHashDeepLink } from "./use-hash-deep-link";

const openTab = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ openTab }) }));

describe("hash derin bağlantı → sekme", () => {
  beforeEach(() => {
    openTab.mockClear();
    window.history.replaceState(null, "", "#/");
  });

  it("kabuk dışı yollar sekme açmaz", () => {
    for (const h of ["", "#/", "#/login", "#/2fa-kurulum?t=1", "#/tezgah-tv"])
      expect(deepLinkTarget(h)).toBeNull();
  });

  it("içerik yolu sorgusuyla birlikte döner", () => {
    expect(deepLinkTarget("#/operations/orders")).toBe("/operations/orders");
    expect(deepLinkTarget("#/operations/orders?status=OPEN")).toBe("/operations/orders?status=OPEN");
  });

  it("açılışta hash'teki ekran sekmede açılır, hash #/'e iner", () => {
    window.history.replaceState(null, "", "#/operations/orders");
    renderHook(() => useHashDeepLink());
    expect(openTab).toHaveBeenCalledWith("/operations/orders");
    expect(window.location.hash).toBe("#/");
  });

  it("çalışırken hash değişince hedef sekmeye geçer", () => {
    renderHook(() => useHashDeepLink());
    expect(openTab).not.toHaveBeenCalled();
    window.location.hash = "#/warehouse";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(openTab).toHaveBeenCalledWith("/warehouse");
  });
});
