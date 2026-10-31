// SY-H1 kabulü: altı hata sınıfının her biri örnek dosyada raporlanır; temiz dosyada bulgu yok;
// bulgulu satır varsayılan CSV'ye girmez, düzeltilmiş kabulde önerilen değerle girer.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseArgs } from "../tul-excel.ts";
import { parseGramFormula, parseLooseNumber } from "./cells.ts";
import { convert, summarize } from "./convert.ts";
import { buildOutputs, toCsv } from "./output.ts";
import { ERROR_CLASSES } from "./types.ts";

interface WeftSpecRow {
  name: string;
  repeat: number | string;
  picks: number;
  formula: string;
}

/** Fabrika düzeninin özü: sol üstte atkı sırası + armür, altta "Desen No" bloğu ve atkı tablosu. */
function addDesignSheet(wb: ExcelJS.Workbook, no: string, p: { repeatCm: number; density: number; cost: number | string; wefts: WeftSpecRow[] }) {
  const ws = wb.addWorksheet(no);
  ["A", "B", "A", "C"].forEach((l, i) => {
    ws.getCell(4 + i, 8).value = i + 1;
    ws.getCell(4 + i, 9).value = l;
  });
  for (let c = 0; c < 4; c++) ws.getCell(4, 14 + c).value = c + 1;
  ws.getCell(5, 14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
  ws.getCell(14, 12).value = "WEFT NO 6037";
  ws.getCell(15, 12).value = "DOBBY NO BEZ";
  ws.getCell(14, 18).value = "A";
  ws.getCell(14, 19).value = "70/800 TERGAL";
  ws.getCell(16, 2).value = "V01";
  ws.getCell(16, 3).value = "GÜMÜŞ";
  ws.getCell(16, 4).value = "EKRU";
  ws.getCell(24, 2).value = "Desen No";
  ws.getCell(24, 3).value = no;
  ws.getCell(24, 4).value = "TERGAL-DÖNER";
  ws.getCell(25, 2).value = "Desen Boyu";
  ws.getCell(25, 3).value = p.repeatCm;
  ws.getCell(26, 2).value = "Atkı Sıklığı";
  ws.getCell(26, 3).value = p.density;
  ws.getCell(27, 2).value = "Ortalama Sıklık";
  ws.getCell(27, 3).value = p.density;
  ws.getCell(28, 2).value = "Atkılar";
  p.wefts.forEach((w, i) => {
    const r = 29 + i;
    ws.getCell(r, 1).value = i + 1;
    ws.getCell(r, 2).value = w.name;
    ws.getCell(r, 3).value = w.repeat;
    ws.getCell(r, 5).value = w.picks;
    ws.getCell(r, 7).value = { formula: w.formula.replace(/E\b/, `E${r}`), result: 0 } as ExcelJS.CellFormulaValue;
  });
  ws.getCell(37, 2).value = "MALİYET";
  ws.getCell(37, 3).value = p.cost;
  ws.getCell(37, 4).value = "4 CENT";
}

function addCostSheet(wb: ExcelJS.Workbook, name: string, lines: { name: string; picks: number; formula: string }[]) {
  const ws = wb.addWorksheet(name);
  ws.getCell("H1").value = "FASON";
  ws.getCell("H2").value = 2;
  lines.forEach((l, i) => {
    const r = 3 + i;
    ws.getCell(r, 1).value = l.name;
    ws.getCell(r, 3).value = l.picks;
    ws.getCell(r, 5).value = 3.6;
    ws.getCell(r, 6).value = { formula: l.formula.replace(/C\b/, `C${r}`), result: 0 } as ExcelJS.CellFormulaValue;
  });
  const s = 3 + lines.length;
  ws.getCell(s, 1).value = "İPLİK MALİYETİ";
  ws.getCell(s, 7).value = 0.7903;
  ws.getCell(s + 1, 1).value = "TOPLAM";
  ws.getCell(s + 1, 7).value = 1.6134;
}

/** Elle yazılı yeniden okuma: exceljs'in yazdığı dosya fabrika dosyası gibi diskten okunur. */
async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await wb.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  return back;
}

const CLEAN_WEFTS: WeftSpecRow[] = [
  { name: "70/800 TERGAL", repeat: 15, picks: 975, formula: "(E*3.15)*77/9000" },
  { name: "MC281", repeat: 4, picks: 260, formula: "(E*3.15)*680/9000" },
  { name: "MAKARNA", repeat: 1, picks: 65, formula: "(E*3.15)*6100/9000" },
];

async function cleanBooks() {
  const design = new ExcelJS.Workbook();
  addDesignSheet(design, "D2001", { repeatCm: 1.5385, density: 13, cost: 1.98, wefts: CLEAN_WEFTS });
  const cost = new ExcelJS.Workbook();
  addCostSheet(cost, "3000 SERİSİ", [{ name: "165 TTM 350 TUR", picks: 1700, formula: "C*3.3*185/9000" }]);
  return { design: await roundTrip(design), cost: await roundTrip(cost) };
}

async function dirtyBooks() {
  const design = new ExcelJS.Workbook();
  addDesignSheet(design, "D2001", { repeatCm: 1.5385, density: 13, cost: 1.98, wefts: CLEAN_WEFTS });
  addDesignSheet(design, "D2017", {
    repeatCm: 1.5, // Σ rapor 23 ÷ 1,5 = 15,3 ≠ sıklık 12 → SIKLIK_RAPOR_TUTMUYOR
    density: 12,
    cost: "1,90 $", // METIN_SAYI
    wefts: [
      { name: "165 TTM 350 TUR", repeat: 20, picks: 996, formula: "(E*3.15)*180/9000" }, // SISIRME_FARKLI (maliyetteki 185 ↔ 180)
      { name: "ŞEFFAF SİM", repeat: 3, picks: 204, formula: "(E*3.3)*660/8000" }, // EN_TUTARSIZ + BIRIM_8000
      { name: "ZİNCİR", repeat: 0, picks: 0, formula: "(E*3.15)*3000/9000" },
    ],
  });
  const cost = new ExcelJS.Workbook();
  addCostSheet(cost, "3000 SERİSİ", [
    { name: "165 TTM 350 TUR", picks: 1700, formula: "C*3.3*185/9000" },
    { name: "120 DEN FOLDET", picks: 100, formula: "C*3.3*140/1000" }, // BIRIM_1000
  ]);
  return { design: await roundTrip(design), cost: await roundTrip(cost) };
}

function run(books: { design: ExcelJS.Workbook; cost: ExcelJS.Workbook }) {
  return convert({ designBook: { name: "desen.xlsx", workbook: books.design }, costBook: { name: "maliyet.xlsx", workbook: books.cost } });
}

describe("tul-excel dönüştürücü (SY-H1)", () => {
  it("örnek dosyada altı hata sınıfının HER BİRİ raporda", async () => {
    const result = run(await dirtyBooks());
    const counts = Object.fromEntries(summarize(result).map((s) => [s.errorClass, s.total]));
    for (const cls of ERROR_CLASSES) expect(counts[cls], `${cls} raporda yok`).toBeGreaterThan(0);
    const byClass = (cls: string) => result.report.filter((r) => r.errorClass === cls);
    expect(byClass("METIN_SAYI")[0]).toMatchObject({ sheet: "D2017", cell: "C37", excelValue: "1,90 $", suggested: "1.9" });
    expect(byClass("BIRIM_8000")[0]).toMatchObject({ sheet: "D2017", cell: "G30", excelValue: "660/8000" });
    expect(byClass("BIRIM_1000")[0]).toMatchObject({ sheet: "3000 SERİSİ", cell: "F4" });
    expect(byClass("EN_TUTARSIZ")[0]).toMatchObject({ sheet: "D2017", cell: "G30", excelValue: "3.3", suggested: "3.15" });
    expect(byClass("SIKLIK_RAPOR_TUTMUYOR").map((r) => r.cell)).toContain("C25");
    expect(byClass("SISIRME_FARKLI").find((r) => r.sheet === "D2017")?.suggested).toBe("nominal 165 den + fire %8.33");
  });

  it("temiz dosyada bulgu yok; desen + atkı + varyant + armür + maliyet özeti çıkar", async () => {
    const result = run(await cleanBooks());
    expect(result.report).toEqual([]);
    expect(result.designs).toHaveLength(1);
    const d = result.designs[0]!;
    expect(d).toMatchObject({ designNo: "D2001", designType: "TERGAL-DÖNER", weftNo: "6037", dobbyNo: "BEZ", costUsd: 1.98 });
    expect(d.weftMap.A).toBe("70/800 TERGAL");
    expect(d.weftSequence).toBe("A B A C");
    expect(d.liftPlan).toBe("1000");
    expect(d.variants[0]).toMatchObject({ code: "V01", metallic: "GÜMÜŞ", dyeProcess: "EKRU" });
    expect(result.costSheets[0]?.summary).toMatchObject({ "İPLİK MALİYETİ": 0.7903, TOPLAM: 1.6134 });
  });

  it("bulgulu desen varsayılan CSV'ye girmez; düzeltilmiş kabulde önerilen değerle girer", async () => {
    const result = run(await dirtyBooks());
    const strict = buildOutputs(result, "desen.xlsx", false);
    const no = (t: { rows: unknown[][] }) => t.rows.map((r) => r[0]);
    expect(no(strict.files["desenler.csv"]!)).toEqual(["D2001"]);
    expect(strict.excluded.map((e) => e.sheet)).toContain("D2017");
    const lenient = buildOutputs(result, "desen.xlsx", true);
    expect(no(lenient.files["desenler.csv"]!)).toEqual(["D2001", "D2017"]);
    const makarna = lenient.files["desen-atkilari.csv"]!.rows.find((r) => r[0] === "D2017" && r[2] === "ŞEFFAF SİM")!;
    expect(makarna[5]).toBe(3.15); // en önerisi
    expect(makarna[4]).toBe(156.5); // 3 × 12 × 100 ÷ 23
    expect(makarna[10]).toBe(Math.round(((156.5 * 3.15 * 660) / 9000) * 1e4) / 1e4); // ÷9000 + en önerisi
  });

  it("formül ve metin sayı ayrıştırıcıları", () => {
    expect(parseGramFormula("(E29*3.15)*77/9000")).toEqual({ width: 3.15, denier: 77, divisor: 9000 });
    expect(parseGramFormula("C17*120/9000*3.3")).toEqual({ width: 3.3, denier: 120, divisor: 9000 });
    expect(parseGramFormula("B3*360/9000")).toEqual({ width: null, denier: 360, divisor: 9000 });
    expect(parseGramFormula("SUM(G3:G65)/100")).toBeNull();
    expect(parseLooseNumber("2,56 $")).toBe(2.56);
    expect(parseLooseNumber("14 SIKLIK")).toBe(14);
    expect(parseLooseNumber("1/69 MX")).toBeNull();
  });

  it("CSV: BOM + ';' ayraç; formülle başlayan metin önekli, negatif sayı öneksiz", () => {
    const csv = toCsv({ header: ["a", "b"], rows: [["=HYPERLINK(1)", -1.5], ["x;y", null]] });
    expect(csv).toBe("\uFEFFa;b\r\n'=HYPERLINK(1);-1.5\r\n\"x;y\";\r\n");
  });

  it("argümanlar: dry-run varsayılan, bilinmeyen argüman reddedilir", () => {
    expect(parseArgs(["--desen", "a.xlsx"])).toEqual({ designPath: "a.xlsx", acceptCorrections: false });
    expect(() => parseArgs(["--desen", "a.xlsx", "--apply"])).toThrow(/Bilinmeyen/);
    expect(() => parseArgs([])).toThrow(/En az biri/);
  });
});
