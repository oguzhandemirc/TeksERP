// =============================================================================
// Patron rapor dosyası — SheetSpec[] → .xlsx baytı. Panelin `lib/xlsx-export.ts` `buildWorkbook` aynası (aynı
// paket exceljs ^4.4.0; ön satırlar kalın, başlık gri, TOPLAM kalın, notlar italik, başlık dondurulmuş + süzgeç).
// exceljs açılışı şişirmesin diye ilk dosyada yüklenir.
// =============================================================================
import type { SheetSpec } from "./cikti";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HEADER_FILL = "FFEFEFEF";
// Excel sayfa adı: ≤31 karakter ve : \ / ? * [ ] yasak; aynı ad ikinci kez verilemez.
const sanitizeSheetName = (n: string) => n.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

export async function buildWorkbook(sheets: readonly SheetSpec[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "TeksERP";
  const used = new Set<string>();
  for (const spec of sheets) {
    let name = sanitizeSheetName(spec.name);
    for (let i = 2; used.has(name); i++) name = `${sanitizeSheetName(spec.name).slice(0, 27)} (${i})`;
    used.add(name);
    const ws = wb.addWorksheet(name);
    ws.columns = spec.columns.map((c) => ({ key: c.key, width: c.width ?? 16 }));
    for (const line of spec.preamble ?? []) {
      const pr = ws.addRow(line);
      if (line.length === 1) pr.font = { bold: true };
      else pr.getCell(1).font = { bold: true };
    }
    ws.addRow([]);
    const headerRow = ws.addRow(spec.columns.map((c) => c.header));
    const headerRowNo = headerRow.number;
    headerRow.font = { bold: true };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    headerRow.alignment = { vertical: "middle" };

    const aligned = spec.columns.map((c, idx) => ({ idx: idx + 1, align: c.align })).filter((c) => c.align);
    const alignRow = (row: { getCell: (n: number) => { alignment: unknown } }) => {
      for (const c of aligned) row.getCell(c.idx).alignment = { horizontal: c.align };
    };
    for (const r of spec.rows) alignRow(ws.addRow(r));
    spec.columns.forEach((c, idx) => {
      if (c.numFmt) ws.getColumn(idx + 1).numFmt = c.numFmt;
    });
    if (spec.totalRow) {
      const tr = ws.addRow(spec.totalRow);
      tr.font = { bold: true };
      alignRow(tr);
    }
    if (spec.notes?.length) {
      ws.addRow([]);
      for (const n of spec.notes) ws.addRow([n]).font = { italic: true, color: { argb: "FF666666" } };
    }
    ws.views = [{ state: "frozen", ySplit: headerRowNo }];
    if (spec.columns.length > 0) ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: spec.columns.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
