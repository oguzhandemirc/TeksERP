import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { kit, kitBox, kitRequested, renderKitPano, resetKit, setPrefs } from "./pano-test-kit";

// Görünüm (tema/yoğunluk) değişimi panoyu yeniden kurmaz: grafik sökülmez, kutu isteği tekrarlanmaz.
const CATALOG = [kitBox("uretim", "kpi", true), kitBox("egilim", "genis", true)];
const DATA = {
  uretim: { metre: { deger: 10, onceki: 0, degisimYuzde: null }, top: { deger: 1, onceki: 0, degisimYuzde: null } },
  egilim: { kova: "gun", noktalar: [{ anahtar: "2026-11-10", uretimMetre: 10, sevkMetre: null }] },
};

beforeEach(() => resetKit(CATALOG, DATA));

describe("Pano — görünüm değişimi", () => {
  it("tema/yoğunluk tercihi değişince grafik sökülmez, istek tekrarlanmaz, iskelet yok", async () => {
    await renderKitPano();
    const chart = await screen.findByTestId("grafik");
    document.documentElement.setAttribute("data-density", "comfortable");
    setPrefs({ ...kit.prefs, appearance: { density: "comfortable", preset: "orman" } });
    await waitFor(() => expect(screen.getByTestId("grafik")).toBe(chart));
    expect(kitRequested()).toHaveLength(1);
    expect(screen.queryByTestId("pano-iskelet")).toBeNull();
    document.documentElement.removeAttribute("data-density");
  });
});
