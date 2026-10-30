import { describe, expect, it } from "vitest";
import { cellText, columnFormat, tableToExport } from "./table-model";
import { formatFigure } from "./figures";
import type { TabloBlok } from "./sunum";

// Masraf Özeti biçimi: ay kolonları + Toplam, hepsi TL. Bir ay kuruşlu, öteki tam sayı.
const TABLE: TabloBlok = {
  kolonlar: [
    { anahtar: "kategori", baslik: "Kategori" },
    { anahtar: "m1", baslik: "Ocak", birim: "TRY", hiza: "sag" },
    { anahtar: "m2", baslik: "Şubat", birim: "TRY", hiza: "sag" },
    { anahtar: "metre", baslik: "Metre", birim: "m" },
  ],
  satirlar: [
    { kategori: "Elektrik", m1: 45000.4, m2: 45000, metre: 12.5 },
    { kategori: "Su", m1: 1200, m2: 300, metre: 3 },
  ],
  toplam: { kategori: "Toplam", m1: 46200.4, m2: 45300, metre: 15.5 },
};

describe("rapor v2 tablosu — para kolonları tek biçim", () => {
  it("aynı tablodaki TL kolonları aynı ondalıkla basılır (kuruşlu kolon da)", () => {
    const [, m1, m2] = TABLE.kolonlar;
    const f1 = columnFormat(TABLE, m1!);
    const f2 = columnFormat(TABLE, m2!);
    expect(f1).toEqual(f2);
    expect(cellText(45000.4, f1)).toBe(cellText(45000, f2));
    expect(cellText(45000, f2)).toBe("45.000");
  });

  it("para kolonu kartla (formatFigure) aynı metni basar", () => {
    const f = columnFormat(TABLE, TABLE.kolonlar[1]!);
    expect(`${cellText(46200.4, f)} TL`).toBe(formatFigure(46200.4, "TRY"));
  });

  it("Excel/PDF zarfı ekranla aynı biçimi taşır; para dışı kolon ölçülen ondalıkta kalır", () => {
    const cols = tableToExport(TABLE, "Tablo").columns;
    expect(cols[1]!.numFmt).toBe(cols[2]!.numFmt);
    expect(cols[1]!.numFmt).toBe("#,##0");
    expect(cols[3]!.numFmt).toBe("#,##0.0");
    expect(cols[0]!.numFmt).toBeUndefined();
  });
});
