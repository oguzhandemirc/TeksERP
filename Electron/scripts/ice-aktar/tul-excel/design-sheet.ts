// Desen sayfası (DÖNER DESENLER.xlsx; sayfa başı bir desen) okuyucusu + sayfa içi denetimler.
import type ExcelJS from "exceljs";
import { cellText, formulaText, parseGramFormula, readNumber, round } from "./cells.ts";
import { checkTextNumber, checkUnitDivisor, type ReportSink } from "./checks.ts";
import { findLabel, findPrefixed, readLiftPlan, readVariants, readWeftMap, readWeftSequence, scanCells } from "./sheet-scan.ts";
import type { DesignSheet, WeftLine } from "./types.ts";

type Worksheet = ExcelJS.Worksheet;

/** Elle yazılan metredeki atkı ile `rapor × sıklık × 100 / Σrapor` arasındaki tolerans. */
export const DENSITY_TOLERANCE = 0.01;

function readField(ws: Worksheet, label: { row: number; col: number } | null, file: string, sink: ReportSink) {
  if (!label) return { value: null, cell: "" };
  const cell = ws.getRow(label.row).getCell(label.col + 1);
  const read = readNumber(cell);
  checkTextNumber(sink, { file, sheet: ws.name, cell: cell.address, read, inUse: true, field: cellText(ws.getRow(label.row).getCell(label.col)) });
  return { value: read.value, cell: cell.address };
}

function readWefts(ws: Worksheet, headerRow: number, file: string, sink: ReportSink): WeftLine[] {
  const out: WeftLine[] = [];
  for (let r = headerRow + 1; r <= headerRow + 12; r++) {
    const row = ws.getRow(r);
    const order = readNumber(row.getCell(1)).value;
    if (order === null) break;
    const yarnName = cellText(row.getCell(2));
    const repeat = readNumber(row.getCell(3));
    const picks = readNumber(row.getCell(5));
    const gramCell = row.getCell(7);
    const inUse = (repeat.value ?? 0) > 0 || (picks.value ?? 0) > 0;
    const base = { file, sheet: ws.name, inUse };
    checkTextNumber(sink, { ...base, cell: row.getCell(3).address, read: repeat, field: "Rapordaki atkı" });
    checkTextNumber(sink, { ...base, cell: row.getCell(5).address, read: picks, field: "Metredeki atkı" });
    const formula = parseGramFormula(formulaText(gramCell));
    const line: WeftLine = {
      ...base,
      row: r,
      order,
      yarnName,
      repeatCount: repeat.value,
      picksPerMeter: picks.value,
      picksCell: row.getCell(5).address,
      gramCell: gramCell.address,
      gramExcel: readNumber(gramCell).value,
      formula,
    };
    checkUnitDivisor(sink, line, line.picksPerMeter);
    out.push(line);
  }
  return out;
}

/**
 * SIKLIK_RAPOR_TUTMUYOR: (1) Σrapor ÷ desen boyu ≠ sıklık → desen boyu hücresi;
 * (2) her satırda metredeki atkı ≠ rapor × sıklık × 100 ÷ Σrapor → o hücre.
 */
export function checkDensity(sink: ReportSink, d: DesignSheet, file: string) {
  const used = d.wefts.filter((w) => w.inUse);
  // Raporu yazılmamış kullanılan satır varsa Σ rapor eksik kalır → oran denetlenemez (sahte bulgu üretme).
  if (used.some((w) => (w.repeatCount ?? 0) <= 0)) return;
  const totalRepeat = used.reduce((s, w) => s + (w.repeatCount ?? 0), 0);
  if (d.density === null || d.density <= 0 || totalRepeat === 0) return;
  if (d.repeatCm !== null && d.repeatCm > 0) {
    const implied = totalRepeat / d.repeatCm;
    if (Math.abs(implied - d.density) / d.density > DENSITY_TOLERANCE) {
      sink.add({
        errorClass: "SIKLIK_RAPOR_TUTMUYOR", file, sheet: d.sheet, cell: d.repeatCell, inUse: true,
        excelValue: String(d.repeatCm), suggested: String(round(totalRepeat / d.density, 4)),
        note: `Σ rapor ${totalRepeat} ÷ desen boyu ${d.repeatCm} = ${round(implied, 2)} atkı/cm; sıklık ${d.density}`,
      });
    }
  }
  for (const w of used) {
    if (w.picksPerMeter === null) continue;
    const expected = ((w.repeatCount ?? 0) * d.density * 100) / totalRepeat;
    if (Math.abs(w.picksPerMeter - expected) / expected > DENSITY_TOLERANCE) {
      sink.add({
        errorClass: "SIKLIK_RAPOR_TUTMUYOR", file, sheet: d.sheet, cell: w.picksCell, inUse: true,
        excelValue: String(w.picksPerMeter), suggested: String(round(expected, 1)),
        note: `${w.yarnName}: rapor ${w.repeatCount} × sıklık ${d.density} × 100 ÷ Σ rapor ${totalRepeat}`,
      });
    }
  }
}

export function readDesignSheet(ws: Worksheet, file: string, sink: ReportSink): DesignSheet | null {
  const cells = scanCells(ws);
  const noLabel = findLabel(cells, "Desen No");
  const weftHeader = findLabel(cells, "Atkılar");
  if (!noLabel || !weftHeader) return null;
  const noRow = ws.getRow(noLabel.row);
  const repeat = readField(ws, findLabel(cells, "Desen Boyu"), file, sink);
  const density = readField(ws, findLabel(cells, "Atkı Sıklığı"), file, sink);
  const avg = readField(ws, findLabel(cells, "Ortalama Sıklık"), file, sink);
  const cost = readField(ws, findLabel(cells, "MALİYET"), file, sink);
  const costLabel = findLabel(cells, "MALİYET");
  const topRow = noLabel.row;
  const design: DesignSheet = {
    sheet: ws.name,
    designNo: cellText(noRow.getCell(noLabel.col + 1)) || ws.name.trim(),
    designType: cellText(noRow.getCell(noLabel.col + 2)),
    repeatCm: repeat.value,
    repeatCell: repeat.cell,
    density: density.value,
    densityCell: density.cell,
    averageDensity: avg.value,
    weftNo: findPrefixed(cells, "WEFT NO"),
    dobbyNo: findPrefixed(cells, "DOBBY NO"),
    costUsd: cost.value,
    costNote: costLabel ? cellText(ws.getRow(costLabel.row).getCell(costLabel.col + 2)) : "",
    weftMap: readWeftMap(ws, cells, topRow),
    weftSequence: readWeftSequence(ws, cells, topRow),
    liftPlan: readLiftPlan(ws, cells, topRow),
    wefts: readWefts(ws, weftHeader.row, file, sink),
    variants: readVariants(ws, cells),
  };
  checkDensity(sink, design, file);
  return design;
}
