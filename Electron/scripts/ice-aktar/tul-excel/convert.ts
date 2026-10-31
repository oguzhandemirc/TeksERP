// Dönüştürücünün çekirdeği: iki çalışma kitabını okur, sayfa içi + sayfalar arası denetimleri koşar.
import ExcelJS from "exceljs";
import { checkInflation, checkWidths, ReportSink } from "./checks.ts";
import { readCostSheet } from "./cost-sheet.ts";
import { readDesignSheet } from "./design-sheet.ts";
import { ERROR_CLASSES, type ConversionResult, type CostSheet, type DesignSheet, type YarnRow } from "./types.ts";

export interface WorkbookInput {
  /** Raporda görünen dosya adı. */
  name: string;
  workbook: ExcelJS.Workbook;
}

export interface ConversionInput {
  designBook?: WorkbookInput;
  costBook?: WorkbookInput;
}

export interface SkippedSheet {
  file: string;
  sheet: string;
}

export async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

export function convert(input: ConversionInput): ConversionResult & { skipped: SkippedSheet[] } {
  const sink = new ReportSink();
  const designs: DesignSheet[] = [];
  const costSheets: CostSheet[] = [];
  const skipped: SkippedSheet[] = [];
  const allYarns: YarnRow[] = [];
  if (input.designBook) {
    const { name, workbook } = input.designBook;
    for (const ws of workbook.worksheets) {
      const d = readDesignSheet(ws, name, sink);
      if (!d) {
        skipped.push({ file: name, sheet: ws.name });
        continue;
      }
      designs.push(d);
      checkWidths(sink, ws.name, d.wefts);
      allYarns.push(...d.wefts);
    }
  }
  if (input.costBook) {
    const { name, workbook } = input.costBook;
    for (const ws of workbook.worksheets) {
      const c = readCostSheet(ws, name, sink);
      if (!c) {
        skipped.push({ file: name, sheet: ws.name });
        continue;
      }
      costSheets.push(c);
      checkWidths(sink, ws.name, c.lines);
      allYarns.push(...c.lines);
    }
  }
  checkInflation(sink, allYarns);
  return { designs, costSheets, report: sink.rows, skipped };
}

/** Sınıf başına bulgu sayısı (toplam / kullanımdaki satır). */
export function summarize(result: ConversionResult) {
  return ERROR_CLASSES.map((cls) => {
    const rows = result.report.filter((r) => r.errorClass === cls);
    return { errorClass: cls, total: rows.length, inUse: rows.filter((r) => r.inUse).length };
  });
}
