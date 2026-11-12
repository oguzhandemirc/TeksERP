import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { kitBox, renderKitPano, resetKit } from "./pano-test-kit";
import { kpiColumns } from "./pano-kpi-izgara";

// KPI şeridi: sarmalı eşit ızgara (yetim kart yok) ve değer asla "…" ile kırpılmaz.
const k = (deger: number) => ({ deger, onceki: 0, degisimYuzde: null });
const CATALOG = [kitBox("uretim", "kpi", true), kitBox("tahsilat", "kpi", true)];
const DATA = {
  uretim: { metre: k(12345.6), top: k(3) },
  tahsilat: { tutarlar: [{ paraBirimi: "TRY", deger: 25000, onceki: 0, degisimYuzde: null }] },
};

beforeEach(() => resetKit(CATALOG, DATA));

describe("Pano — KPI şeridi", () => {
  it("sığan kartlar satırı paylaşır; sarınca satırlar dengelenir (7 kart / 6 sığar → 4 + 3)", () => {
    expect(kpiColumns(3, 1160, 14)).toBe(3);
    expect(kpiColumns(7, 1160, 14)).toBe(4);
    expect(kpiColumns(6, 1160, 14)).toBe(6);
    expect(kpiColumns(8, 900, 14)).toBe(4); // 4 sığar → 4 + 4
    expect(kpiColumns(5, 900, 14)).toBe(3); // 4 sığar → 4 + 1 yerine 3 + 2
    expect(kpiColumns(5, 300, 14)).toBe(1);
    expect(kpiColumns(0, 1000, 14)).toBe(1);
  });

  it("para ve ölçü değeri kırpılmaz (truncate yok, dar kartta küçülür/birim alt satıra iner)", async () => {
    await renderKitPano();
    const para = await screen.findByText("25.000,00 TRY");
    const value = para.closest("[data-value-fit]")!;
    expect(value).toBeTruthy();
    expect(value.className).not.toMatch(/truncate|text-ellipsis/);
    expect(value.className).toMatch(/text-sm/);
    const metre = screen.getByText(/^12345,6 m$/).closest("[data-value-fit]")!;
    expect(metre.className).not.toMatch(/truncate/);
  });
});
