// Akışlı Excel (Perf-2 B4): renderer satırları parça parça yollar, ana süreç exceljs
// WorkbookWriter ile diske yazar — büyük listede çalışma kitabı renderer belleğinde kurulmaz.
// Tel yükü ana süreçte BURADAKİ doğrulayıcılardan geçer (renderer'a güvenilmez).

/** Hücre: düz değer ya da hücre başına sayı biçimli değer (`f` = Excel numFmt). */
export type XlsxCellValue = string | number | null;
export type XlsxCell = XlsxCellValue | { v: XlsxCellValue; f: string };

export interface XlsxStreamColumn {
  header: string;
  width: number;
  align?: "left" | "right" | "center";
}

export interface XlsxStreamBeginOpts {
  /** Önerilen dosya adı (uzantı eklenir). */
  suggestedName: string;
  sheetName: string;
  columns: XlsxStreamColumn[];
  /** Tablonun üstündeki başlık satırları (tek hücreli satır kalın). */
  preamble: XlsxCellValue[][];
}
export interface XlsxStreamRowsOpts {
  sessionId: string;
  rows: XlsxCell[][];
}
export interface XlsxStreamEndOpts {
  sessionId: string;
  totalRow?: XlsxCell[];
  notes?: string[];
}
export type XlsxStreamBeginResult = { ok: true; sessionId: string } | { ok: false; canceled?: boolean; error?: string };
export type XlsxStreamResult = { ok: true; path?: string } | { ok: false; error: string };

export const XLSX_STREAM_MAX_CHUNK = 10_000;
export const XLSX_STREAM_MAX_COLUMNS = 512;
/** Excel hücre metni tavanı. */
export const XLSX_MAX_CELL_CHARS = 32_767;
/** Excel sayfa satır tavanı (1.048.576) altında pay. */
export const XLSX_STREAM_MAX_ROWS = 1_048_000;
const MAX_NAME = 200;
const MAX_FMT = 255;
const MAX_PREAMBLE = 20;
const MAX_NOTES = 50;
const ALIGNS = new Set(["left", "right", "center"]);
const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function isValue(v: unknown): v is XlsxCellValue {
  return v === null || isStr(v, XLSX_MAX_CELL_CHARS) || (typeof v === "number" && Number.isFinite(v));
}

function isCell(v: unknown): v is XlsxCell {
  if (isValue(v)) return true;
  return isObj(v) && Object.keys(v).length === 2 && isValue(v.v) && isStr(v.f, MAX_FMT) && v.f.length > 0;
}

const isRow = (v: unknown, maxCells: number): v is XlsxCell[] => Array.isArray(v) && v.length <= maxCells && v.every(isCell);

export function parseXlsxStreamBegin(p: unknown): XlsxStreamBeginOpts | null {
  if (!isObj(p) || !isStr(p.suggestedName, MAX_NAME) || !isStr(p.sheetName, MAX_NAME)) return null;
  const { columns, preamble } = p;
  if (!Array.isArray(columns) || columns.length === 0 || columns.length > XLSX_STREAM_MAX_COLUMNS) return null;
  const cols: XlsxStreamColumn[] = [];
  for (const c of columns) {
    if (!isObj(c) || !isStr(c.header, XLSX_MAX_CELL_CHARS)) return null;
    if (typeof c.width !== "number" || !(c.width > 0 && c.width <= 255)) return null;
    if (c.align !== undefined && !ALIGNS.has(c.align as string)) return null;
    cols.push({ header: c.header, width: c.width, ...(c.align ? { align: c.align as XlsxStreamColumn["align"] } : {}) });
  }
  if (!Array.isArray(preamble) || preamble.length > MAX_PREAMBLE) return null;
  if (!preamble.every((r) => Array.isArray(r) && r.length <= cols.length && r.every(isValue))) return null;
  return { suggestedName: p.suggestedName, sheetName: p.sheetName, columns: cols, preamble: preamble as XlsxCellValue[][] };
}

export function parseXlsxStreamRows(p: unknown, columnCount: number): XlsxStreamRowsOpts | null {
  if (!isObj(p) || !isStr(p.sessionId, 36) || !SESSION_RE.test(p.sessionId)) return null;
  const { rows } = p;
  if (!Array.isArray(rows) || rows.length > XLSX_STREAM_MAX_CHUNK) return null;
  if (!rows.every((r) => isRow(r, columnCount))) return null;
  return { sessionId: p.sessionId, rows: rows as XlsxCell[][] };
}

export function parseXlsxStreamEnd(p: unknown, columnCount: number): XlsxStreamEndOpts | null {
  if (!isObj(p) || !isStr(p.sessionId, 36) || !SESSION_RE.test(p.sessionId)) return null;
  if (p.totalRow !== undefined && !isRow(p.totalRow, columnCount)) return null;
  const notes = p.notes;
  if (notes !== undefined && !(Array.isArray(notes) && notes.length <= MAX_NOTES && notes.every((n) => isStr(n, XLSX_MAX_CELL_CHARS)))) return null;
  return {
    sessionId: p.sessionId,
    ...(p.totalRow ? { totalRow: p.totalRow as XlsxCell[] } : {}),
    ...(notes ? { notes: notes as string[] } : {}),
  };
}

/** Oturum kimliği biçimi (abort yolu yalnız bunu taşır). */
export const isXlsxSessionId = (v: unknown): v is string => typeof v === "string" && SESSION_RE.test(v);
