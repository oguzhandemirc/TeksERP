import type { IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import type { Row, Workbook, Worksheet } from "exceljs";
import { handleTrusted } from "../security/trusted-ipc.js";
import { showSaveDialogFor } from "./dialog-window.js";
import {
  XLSX_STREAM_MAX_ROWS,
  isXlsxSessionId,
  parseXlsxStreamBegin,
  parseXlsxStreamEnd,
  parseXlsxStreamRows,
  type XlsxCell,
  type XlsxCellValue,
  type XlsxStreamBeginResult,
  type XlsxStreamColumn,
  type XlsxStreamResult,
} from "../../shared/xlsx-stream.js";

// =============================================================================
// Akışlı Excel — renderer satırları ≤10K'lık parçalarla yollar; çalışma kitabı
// `.part` dosyasına exceljs WorkbookWriter ile yazılır, bitince hedef ada taşınır.
// Biçim `src/lib/xlsx-export.buildWorkbook`un liste sayfasıyla AYNIDIR (eşitlik
// bekçisi `src/lib/xlsx-stream.equal.test.ts`): satır stili commit() ÖNCESİ verilir,
// görünüm ve kolonlar ilk satırdan önce (sheetData'dan önce yazılırlar).
// =============================================================================

const HEADER_FILL = "FFEFEFEF";
const BAD_INPUT = "Excel verisi geçersiz";
const WRITE_FAILED = "Excel dosyası yazılamadı";

interface StreamWriter {
  commit(): Promise<void>;
}
interface Session {
  id: string;
  senderId: number;
  wb: Workbook & StreamWriter;
  ws: Worksheet & StreamWriter;
  columns: XlsxStreamColumn[];
  out: WriteStream;
  /** Dosya tanıtıcısı kapanınca çözülür (Windows'ta açık dosya taşınamaz/silinemez). */
  closed: Promise<void>;
  partPath: string;
  finalPath: string;
  rowCount: number;
}

const sessions = new Map<string, Session>();

const cellValue = (c: XlsxCell): XlsxCellValue => (c !== null && typeof c === "object" ? c.v : c);
// null hücre yazılmaz (eski yolda nesne satırının eksik anahtarı gibi).
const rowValues = (cells: readonly XlsxCell[]): unknown[] => cells.map((c) => cellValue(c) ?? undefined);

/** Veri/TOPLAM satırı: kolon hizası + hücre başına numFmt — commit() öncesi. */
function styleDataRow(row: Row, cells: readonly XlsxCell[], columns: readonly XlsxStreamColumn[]): void {
  columns.forEach((col, i) => {
    if (col.align) row.getCell(i + 1).alignment = { horizontal: col.align };
  });
  cells.forEach((c, i) => {
    if (c !== null && typeof c === "object") row.getCell(i + 1).numFmt = c.f;
  });
}

async function dropSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  // Yarım kitap commit'lenmez: zip durdurulur, dosya kapanır, .part silinir.
  (s.wb as unknown as { zip?: { abort?: () => void } }).zip?.abort?.();
  s.out.destroy();
  await s.closed;
  await rm(s.partPath, { force: true }).catch(() => undefined);
}

function ownSession(e: IpcMainInvokeEvent, id: unknown): Session | null {
  if (!isXlsxSessionId(id)) return null;
  const s = sessions.get(id);
  return s && s.senderId === e.sender.id ? s : null;
}

async function begin(e: IpcMainInvokeEvent, payload: unknown): Promise<XlsxStreamBeginResult> {
  const opts = parseXlsxStreamBegin(payload);
  if (!opts) return { ok: false, error: BAD_INPUT };
  for (const [id, s] of sessions) if (s.senderId === e.sender.id) await dropSession(id);
  const base = opts.suggestedName.replace(/[^\p{L}\p{N}\-_. ]/gu, "_").slice(0, 100) || "Liste";
  const { canceled, filePath } = await showSaveDialogFor(e, {
    title: "Kaydet",
    defaultPath: base.endsWith(".xlsx") ? base : `${base}.xlsx`,
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const id = randomUUID();
  const partPath = `${filePath}.part`;
  let out: WriteStream | null = null;
  let closed: Promise<void> = Promise.resolve();
  try {
    const { default: ExcelJS } = await import("exceljs");
    out = createWriteStream(partPath);
    const stream = out;
    closed = new Promise<void>((resolve) => stream.once("close", () => resolve()));
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useSharedStrings: false, useStyles: true });
    wb.creator = "TeksERP";
    const headerRowNo = opts.preamble.length ? opts.preamble.length + 2 : 1;
    const ws = wb.addWorksheet(opts.sheetName.replace(/[:\\/?*[\]]/g, " ").slice(0, 31), {
      views: [{ state: "frozen", ySplit: headerRowNo }],
    }) as Worksheet & StreamWriter;
    ws.columns = opts.columns.map((c, i) => ({ key: `c${i}`, width: c.width }));
    for (const line of opts.preamble) {
      const pr = ws.addRow(rowValues(line));
      if (line.length === 1) pr.font = { bold: true };
      else pr.getCell(1).font = { bold: true };
      pr.commit();
    }
    if (opts.preamble.length) ws.addRow([]).commit();
    const hr = ws.addRow(opts.columns.map((c) => c.header));
    hr.font = { bold: true };
    hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    hr.alignment = { vertical: "middle" };
    hr.commit();
    ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: opts.columns.length } };
    sessions.set(id, { id, senderId: e.sender.id, wb: wb as Workbook & StreamWriter, ws, columns: opts.columns, out, closed, partPath, finalPath: filePath, rowCount: 0 });
    e.sender.once("destroyed", () => void dropSession(id));
    return { ok: true, sessionId: id };
  } catch {
    out?.destroy();
    await closed;
    await rm(partPath, { force: true }).catch(() => undefined);
    return { ok: false, error: WRITE_FAILED };
  }
}

async function addRows(e: IpcMainInvokeEvent, payload: unknown): Promise<XlsxStreamResult> {
  const s = ownSession(e, (payload as { sessionId?: unknown } | null)?.sessionId);
  if (!s) return { ok: false, error: BAD_INPUT };
  const opts = parseXlsxStreamRows(payload, s.columns.length);
  if (!opts || s.rowCount + opts.rows.length > XLSX_STREAM_MAX_ROWS) {
    await dropSession(s.id);
    return { ok: false, error: BAD_INPUT };
  }
  try {
    for (const cells of opts.rows) {
      const row = s.ws.addRow(rowValues(cells));
      styleDataRow(row, cells, s.columns);
      row.commit();
    }
    s.rowCount += opts.rows.length;
    return { ok: true };
  } catch {
    await dropSession(s.id);
    return { ok: false, error: WRITE_FAILED };
  }
}

async function end(e: IpcMainInvokeEvent, payload: unknown): Promise<XlsxStreamResult> {
  const s = ownSession(e, (payload as { sessionId?: unknown } | null)?.sessionId);
  if (!s) return { ok: false, error: BAD_INPUT };
  const opts = parseXlsxStreamEnd(payload, s.columns.length);
  if (!opts) {
    await dropSession(s.id);
    return { ok: false, error: BAD_INPUT };
  }
  try {
    if (opts.totalRow) {
      const tr = s.ws.addRow(rowValues(opts.totalRow));
      tr.font = { bold: true };
      styleDataRow(tr, opts.totalRow, s.columns);
      tr.commit();
    }
    if (opts.notes?.length) {
      s.ws.addRow([]).commit(); // notları TOPLAM'dan ayır (autoFilter aralığına yapışmasın)
      for (const n of opts.notes) {
        const nr = s.ws.addRow([n]);
        nr.font = { italic: true, color: { argb: "FF666666" } };
        nr.commit();
      }
    }
    s.ws.commit();
    await s.wb.commit();
    await s.closed;
    sessions.delete(s.id);
    await rename(s.partPath, s.finalPath);
    return { ok: true, path: s.finalPath };
  } catch {
    await dropSession(s.id);
    await rm(s.partPath, { force: true }).catch(() => undefined);
    return { ok: false, error: WRITE_FAILED };
  }
}

export function registerXlsxIpc(): void {
  handleTrusted("xlsx:streamBegin", begin);
  handleTrusted("xlsx:streamRows", addRows);
  handleTrusted("xlsx:streamEnd", end);
  handleTrusted("xlsx:streamAbort", async (e, id: unknown): Promise<void> => {
    if (ownSession(e, id)) await dropSession(id as string);
  });
}

/** Test yardımcısı: açık oturum sayısı. */
export const openXlsxSessionCount = (): number => sessions.size;
