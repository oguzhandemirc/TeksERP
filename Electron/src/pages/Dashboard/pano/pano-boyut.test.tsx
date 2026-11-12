import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { kit, kitBox, renderKitPano, resetKit } from "./pano-test-kit";
import { cleanSizes } from "./pano-layout";
import { placeMasonry, rowSpanFor } from "./pano-masonry";

// Kutu boyutu kullanıcı tercihi (`dashboard.boxSizes`) ve sütun akışı birimi.
const CATALOG = [kitBox("uretim", "kpi", true), kitBox("tezgah", "kucuk", true, false), kitBox("egilim", "genis", true)];
const DATA = {
  uretim: { metre: { deger: 10, onceki: 0, degisimYuzde: null }, top: { deger: 1, onceki: 0, degisimYuzde: null } },
  tezgah: { toplam: 2, calisan: 1, duran: 0, izlenmeyen: 1, issiz: 1, suAnYuzde: 50 },
  egilim: { kova: "gun", noktalar: [{ anahtar: "2026-11-10", uretimMetre: 10, sevkMetre: null }] },
};
const dash = () => kit.prefs.dashboard as { boxSizes?: Record<string, string> } | undefined;

beforeEach(() => resetKit(CATALOG, DATA));

describe("Pano — kutu boyutu", () => {
  it("düzenleme kipinde boyut seçilir, tercihe yazılır; katalog boyutuna dönünce kayıttan düşer", async () => {
    await renderKitPano();
    await screen.findByTestId("grafik");
    fireEvent.click(screen.getByRole("button", { name: /Panoyu düzenle/ }));
    const grp = within(screen.getByRole("radiogroup", { name: "tezgah boyutu" }));
    expect(grp.getByRole("radio", { name: "Küçük" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(grp.getByRole("radio", { name: "Geniş" }));
    expect(dash()?.boxSizes).toEqual({ tezgah: "genis" });
    expect(within(screen.getByRole("radiogroup", { name: "tezgah boyutu" })).getByRole("radio", { name: "Geniş" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "tezgah boyutu" })).getByRole("radio", { name: "Küçük" }));
    expect(dash()?.boxSizes).toBeUndefined();
  });

  it("KPI kutusunda boyut seçimi yok; varsayılana dön boyutları da siler", async () => {
    resetKit(CATALOG, DATA, { dashboard: { donem: "bugun", boxSizes: { tezgah: "orta" } } });
    await renderKitPano();
    await screen.findByTestId("grafik");
    fireEvent.click(screen.getByRole("button", { name: /Panoyu düzenle/ }));
    expect(screen.queryByRole("radiogroup", { name: "uretim boyutu" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    expect(dash()?.boxSizes).toBeUndefined();
  });

  it("bilinmeyen boyut değeri sessizce düşer; satır birimi yukarı yuvarlar", () => {
    expect(cleanSizes({ a: "genis", b: "dev", c: 3 })).toEqual({ a: "genis" });
    expect(cleanSizes(["x"])).toEqual({});
    expect(rowSpanFor(0)).toBe(1);
    expect(rowSpanFor(201)).toBe(51);
  });

  it("sütun akışı: kısa kutunun altına sonraki kutu oturur, sıra korunur", () => {
    // A geniş (8) uzun, B (4) kısa → C (4) B'nin altına, A'nın yanına; D (4) en alçak hizaya (A'nın altı, sol).
    const p = placeMasonry([
      { key: "A", span: 8, rows: 100 }, { key: "B", span: 4, rows: 30 }, { key: "C", span: 4, rows: 30 }, { key: "D", span: 4, rows: 10 },
    ], 12);
    expect(p).toEqual({ A: { col: 1, row: 1, span: 8 }, B: { col: 9, row: 1, span: 4 }, C: { col: 9, row: 31, span: 4 }, D: { col: 9, row: 61, span: 4 } });
    expect(placeMasonry([{ key: "X", span: 8, rows: 5 }], 2).X).toEqual({ col: 1, row: 1, span: 2 });
    // 3+5'lik iki kutunun altında: 4'lük kutu 3 sütunluk boşluğa esneyerek girer (boş kalmaz).
    const q = placeMasonry([{ key: "a", span: 3, rows: 10 }, { key: "b", span: 5, rows: 40 }, { key: "c", span: 4, rows: 40 }, { key: "d", span: 4, rows: 5 }], 12);
    expect(q.d).toEqual({ col: 1, row: 11, span: 3 });
  });
});
