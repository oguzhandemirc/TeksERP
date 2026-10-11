// TV kipinin yerel tercihi ve hatırlanması: bozuk/kapalı depolama varsayılana düşer; kapanışta
// açık olan TV oturum açılınca geri gelir (aynı pencere → TV yolu, ayrı → son ekran); ayrı
// pencereyi kullanıcı kapatınca unutulur, uygulamayla kapanınca unutulmaz; menü ekran satırları.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { DEFAULT_TV_PREF, markTvOpen, readTvOpen, readTvPref, windowChoicesOf, writeTvPref } from "./tv-prefs";
import { closeTezgahTvWindow, exitTezgahTvHere, isSeparateTvWindow, openTezgahTvHere, openTezgahTvWindow } from "./tv-entry";
import { resetTvRestoreForTest, useTvRestore } from "./useTvRestore";

function Restore() {
  useTvRestore();
  return null;
}

type ClosedCb = (e: { byUser: boolean }) => void;
function stubApi() {
  const state: { closed: ClosedCb | null } = { closed: null };
  const tvWindow = {
    displays: vi.fn(async () => []),
    open: vi.fn(async (r: { displayId: number | null }) => ({ ok: true as const, reused: false, displayId: r.displayId ?? 7 })),
    onClosed: vi.fn((cb: ClosedCb) => {
      state.closed = cb;
      return () => undefined;
    }),
  };
  (window as unknown as { api?: unknown }).api = { tvWindow };
  return { tvWindow, state };
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  resetTvRestoreForTest();
});
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api;
});

describe("tv-prefs", () => {
  it("bozuk kayıt ve kapalı depolama varsayılana düşer, hata atmaz", () => {
    localStorage.setItem("tezgahTv.tercih", "{bozuk");
    expect(readTvPref()).toEqual(DEFAULT_TV_PREF);
    localStorage.setItem("tezgahTv.tercih", JSON.stringify({ kip: "baska", ekranId: 2 }));
    expect(readTvPref()).toEqual(DEFAULT_TV_PREF);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("kapalı");
    });
    expect(readTvPref()).toEqual(DEFAULT_TV_PREF);
    expect(readTvOpen()).toBeNull();
    spy.mockRestore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("kapalı");
    });
    expect(() => writeTvPref({ kip: "ayri", ekranId: 1 })).not.toThrow();
  });

  it("aynı pencerede açış tercihi ve açık işaretini yazar, çıkış işareti siler", () => {
    openTezgahTvHere();
    expect(window.location.hash).toBe("#/tezgah-tv");
    expect(readTvPref().kip).toBe("ayni");
    expect(readTvOpen()).toBe("ayni");
    exitTezgahTvHere();
    expect(readTvOpen()).toBeNull();
  });

  it("ayrı pencere açılınca ekran ve kip hatırlanır; web panelinde açılmaz", async () => {
    expect(await openTezgahTvWindow(null)).toMatchObject({ ok: false });
    stubApi();
    await openTezgahTvWindow(null);
    expect(readTvPref()).toEqual({ kip: "ayri", ekranId: 7 });
    expect(readTvOpen()).toBe("ayri");
  });

  it("ayrı pencere kendini tanır ve çıkışı pencereyi kapatmaktır", () => {
    const close = vi.fn();
    (window as unknown as { api?: unknown }).api = { window: { close } };
    window.location.hash = "#/tezgah-tv";
    expect(isSeparateTvWindow()).toBe(false);
    window.location.hash = "#/tezgah-tv?pencere=ayri";
    expect(isSeparateTvWindow()).toBe(true);
    closeTezgahTvWindow();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("menü: tek ekranda tek satır; çok ekranda birincil olmayan önce ve önerilen", () => {
    expect(windowChoicesOf([])).toEqual([{ displayId: null, label: "Ayrı pencerede aç", suggested: false }]);
    const rows = windowChoicesOf([
      { id: 1, label: "Dizüstü", primary: true, width: 1366, height: 768 },
      { id: 2, label: "TV", primary: false, width: 1920, height: 1080 },
    ]);
    expect(rows.map((r) => [r.displayId, r.suggested])).toEqual([[2, true], [1, false]]);
    expect(rows[0]!.label).toContain("TV (1920×1080)");
  });
});

describe("useTvRestore — Electron TV kipini hatırlar", () => {
  it("⭐ kapanışta aynı pencerede TV açıktı → oturum açılınca TV yoluna döner (bir kez)", () => {
    stubApi();
    markTvOpen("ayni");
    const { unmount } = render(<Restore />);
    expect(window.location.hash).toBe("#/tezgah-tv");
    unmount();
    window.location.hash = "#/";
    render(<Restore />);
    expect(window.location.hash).toBe("#/");
  });

  it("⭐ ayrı pencere açıktı → son ekranda yeniden açılır; kullanıcı kapatınca unutulur, uygulamayla kapanınca unutulmaz", () => {
    const { tvWindow, state } = stubApi();
    writeTvPref({ kip: "ayri", ekranId: 2 });
    markTvOpen("ayri");
    render(<Restore />);
    expect(tvWindow.open).toHaveBeenCalledWith({ displayId: 2 });
    state.closed!({ byUser: false });
    expect(readTvOpen()).toBe("ayri");
    state.closed!({ byUser: true });
    expect(readTvOpen()).toBeNull();
  });

  it("web panelinde (köprü yok) hiçbir şey yapmaz", () => {
    markTvOpen("ayni");
    render(<Restore />);
    expect(window.location.hash).toBe("");
  });
});
