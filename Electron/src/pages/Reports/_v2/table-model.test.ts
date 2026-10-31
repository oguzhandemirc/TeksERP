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
    // Kuruşlu ve tam sayı TL hücresi AYNI hane sayısıyla basılır (kolon başına ölçülmez).
    expect(cellText(45000.4, f1).split(",")[1]!.length).toBe(cellText(45000, f2).split(",")[1]!.length);
    expect(cellText(45000, f2)).toBe("45.000,00");
    expect(cellText(45000.4, f1)).toBe("45.000,40");
  });

  it("para kolonu kartla (formatFigure) aynı metni basar", () => {
    const f = columnFormat(TABLE, TABLE.kolonlar[1]!);
    expect(`${cellText(46200.4, f)} TL`).toBe(formatFigure(46200.4, "TRY"));
    expect(formatFigure(1200, "TRY")).toBe("1.200,00 TL");
  });

  it("TL kuruşlu (2 ondalık) basılır; metre/adet biçimi değişmez (D4-KUC2 g)", () => {
    const f = columnFormat(TABLE, TABLE.kolonlar[1]!);
    expect(cellText(1234.5, f)).toBe("1.234,50");
    expect(columnFormat(TABLE, TABLE.kolonlar[3]!).numFmt).toBe("#,##0.0");
    expect(formatFigure(42300, "m")).toBe("42.300 m");
  });

  it("Excel/PDF zarfı ekranla aynı biçimi taşır; para dışı kolon ölçülen ondalıkta kalır", () => {
    const cols = tableToExport(TABLE, "Tablo").columns;
    expect(cols[1]!.numFmt).toBe(cols[2]!.numFmt);
    expect(cols[1]!.numFmt).toBe("#,##0.00");
    expect(cols[3]!.numFmt).toBe("#,##0.0");
    expect(cols[0]!.numFmt).toBeUndefined();
  });
});
