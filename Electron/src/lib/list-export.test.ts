import { describe, expect, it } from "vitest";
import { buildCsvContent, csvCell, csvNumber, cellText, type ExportColumn } from "./list-export";

// =============================================================================
// CSV SÖZLEŞMESİ — "Türk Excel'i" paketi
// =============================================================================
// Üç karar BİRLİKTE bir sözleşmedir ve tek tek bozulamaz: `;` ayraç + ondalık
// VİRGÜL + UTF-8 BOM. Biri düşerse dosya tr-TR Excel'de sessizce bozulur
// (sayılar metne düşer / Türkçe karakterler kırılır / sütunlar kayar) ve
// kullanıcı bunu ancak toplam tutmayınca fark eder.

interface Row {
  ad: string;
  metraj: number;
  not: string;
}

const COLS: ExportColumn<Row>[] = [
  { label: "Ad", value: (r) => r.ad },
  { label: "Metraj", value: (r) => r.metraj, summable: true },
  { label: "Not", value: (r) => r.not },
];

describe("CSV — Türk Excel'i sözleşmesi", () => {
  it("BOM ile başlar (yoksa Türkçe karakterler çift tıkta bozulur)", () => {
    const csv = buildCsvContent(COLS, []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("ayraç noktalı virgüldür", () => {
    const csv = buildCsvContent(COLS, []);
    expect(csv).toContain("Ad;Metraj;Not");
  });

  it("satır sonu CRLF'tir (Excel standardı)", () => {
    const csv = buildCsvContent(COLS, [{ ad: "A", metraj: 1, not: "" }]);
    expect(csv).toContain("\r\n");
  });

  it("sayılar TR ondalıkla yazılır — binlik ayraç YOK", () => {
    // 1234.5 → "1234,5": nokta yazılsaydı tr-TR Excel hücreyi METİN sayar ve
    // SUM sessizce çalışmaz. Binlik ayraç eklenseydi başka bir sisteme
    // aktarımda ondalıkla karışırdı.
    expect(csvNumber(1234.5)).toBe("1234,5");
    const csv = buildCsvContent(COLS, [{ ad: "A", metraj: 1234.5, not: "" }]);
    expect(csv).toContain("A;1234,5;");
  });

  it("ayraç / tırnak / satır sonu içeren hücre tırnaklanır ve tırnak ikilenir", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('de"me')).toBe('"de""me"');
    expect(csvCell("iki\nsatır")).toBe('"iki\nsatır"');
    expect(csvCell(" boşluk ")).toBe('" boşluk "');
    expect(csvCell("düz")).toBe("düz");
  });

  it("summable kolon varsa TOPLAM satırı basılır", () => {
    const csv = buildCsvContent(COLS, [
      { ad: "A", metraj: 10.5, not: "" },
      { ad: "B", metraj: 4.5, not: "" },
    ]);
    expect(csv).toContain("TOPLAM (2 kayıt);15;");
  });

  it("TOPLAM satırı yalnız summable kolon VARKEN çıkar", () => {
    const plain: ExportColumn<Row>[] = [{ label: "Ad", value: (r) => r.ad }];
    const csv = buildCsvContent(plain, [{ ad: "A", metraj: 1, not: "" }]);
    expect(csv).not.toContain("TOPLAM");
  });

  it("ilişkili nesne değerinde okunur ad seçilir (id basılmaz)", () => {
    expect(cellText({ id: "uuid-1", code: "RNK1", name: "LACİVERT" })).toBe("LACİVERT");
    expect(cellText([{ name: "A" }, { name: "B" }])).toBe("A, B");
    expect(cellText(null)).toBe("");
  });
});
