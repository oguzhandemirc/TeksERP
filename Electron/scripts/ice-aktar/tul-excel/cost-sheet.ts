// Maliyet sayfası (TÜL MALİYET.xlsx; sayfa başı bir ürün ailesi) okuyucusu.
// Sütunlar: A iplik · B çözgü tel · C metrede atkı · E fiyat $/kg · F gramaj · G toplam; altta özet satırları.
import type ExcelJS from "exceljs";
import { cellText, formulaText, parseGramFormula, readNumber } from "./cells.ts";
import { checkTextNumber, checkUnitDivisor, type ReportSink } from "./checks.ts";
import type { CostSheet, CostYarnLine } from "./types.ts";

type Worksheet = ExcelJS.Worksheet;

/** Özet bölümünü başlatan etiket (A sütunu); bu satırdan sonrası iplik satırı değildir. */
const SUMMARY_START = "İPLİK MALİYETİ";
export const SUMMARY_LABELS = [
  "İPLİK MALİYETİ",
  "DOKUMA",
  "APRE-BOYA",
  "KURŞUN-TANBUR",
  "İŞLEMLER TOP",
  "DEVERE",
  "TOPLAM MALİYET",
  "TOPLAM",
] as const;

function readLine(ws: Worksheet, r: number, file: string, sink: ReportSink): CostYarnLine | null {
  const row = ws.getRow(r);
  const yarnName = cellText(row.getCell(1));
  if (yarnName === "") return null;
  const warp = readNumber(row.getCell(2));
  const picks = readNumber(row.getCell(3));
  const price = readNumber(row.getCell(5));
  const gramCell = row.getCell(6);
  const inUse = (warp.value ?? 0) > 0 || (picks.value ?? 0) > 0;
  const base = { file, sheet: ws.name, inUse };
  checkTextNumber(sink, { ...base, cell: row.getCell(2).address, read: warp, field: "Çözgü tel sayısı" });
  checkTextNumber(sink, { ...base, cell: row.getCell(3).address, read: picks, field: "Metrede giden atkı" });
  checkTextNumber(sink, { ...base, cell: row.getCell(5).address, read: price, field: "İplik fiyatı" });
  const line: CostYarnLine = {
    ...base,
    row: r,
    yarnName,
    gramCell: gramCell.address,
    formula: parseGramFormula(formulaText(gramCell)),
    warpEnds: warp.value,
    picksPerMeter: picks.value,
    priceUsdKg: price.value,
    gramExcel: readNumber(gramCell).value,
    totalExcel: readNumber(row.getCell(7)).value,
  };
  checkUnitDivisor(sink, line, line.warpEnds ?? line.picksPerMeter);
  return line;
}

function readSummary(ws: Worksheet, fromRow: number, file: string, sink: ReportSink) {
  const summary: Record<string, number | null> = {};
  for (let r = fromRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = cellText(row.getCell(1)).replace(/\s+/g, " ").toUpperCase();
    const known = SUMMARY_LABELS.find((l) => l === label);
    if (!known || known in summary) continue;
    const read = readNumber(row.getCell(7));
    checkTextNumber(sink, { file, sheet: ws.name, cell: row.getCell(7).address, read, inUse: true, field: known });
    summary[known] = read.value;
  }
  return summary;
}

/** Dokuma fason ücreti (cent/atkı-cm): "FASON" başlığının altındaki hücre. */
function readWeavingRate(ws: Worksheet): number | null {
  for (let c = 1; c <= 12; c++) {
    if (cellText(ws.getRow(1).getCell(c)).toUpperCase() === "FASON") return readNumber(ws.getRow(2).getCell(c)).value;
  }
  return null;
}

export function readCostSheet(ws: Worksheet, file: string, sink: ReportSink): CostSheet | null {
  const lines: CostYarnLine[] = [];
  let summaryRow = 0;
  for (let r = 2; r <= ws.rowCount; r++) {
    const label = cellText(ws.getRow(r).getCell(1)).replace(/\s+/g, " ").toUpperCase();
    if (label === SUMMARY_START) {
      summaryRow = r;
      break;
    }
    const line = readLine(ws, r, file, sink);
    if (line) lines.push(line);
  }
  if (summaryRow === 0) return null;
  return { sheet: ws.name, lines, summary: readSummary(ws, summaryRow, file, sink), weavingRateCent: readWeavingRate(ws) };
}
