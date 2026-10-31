// Sayfa taraması: etiket bulma, A/B/C atkı eşlemesi + sırası, armür ızgarası, varyant listesi.
// Sayfa düzeni serbest (181 farklı yerleşim) → konum değil ETİKET ve desen aranır.
import type ExcelJS from "exceljs";
import { cellText } from "./cells.ts";
import type { Variant } from "./types.ts";

type Worksheet = ExcelJS.Worksheet;

export interface CellPos {
  row: number;
  col: number;
}

/** Sayfadaki bütün dolu hücreler (satır, sütun, metin) — tek tarama. */
export function scanCells(ws: Worksheet): { row: number; col: number; text: string }[] {
  const out: { row: number; col: number; text: string }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const text = cellText(cell);
      if (text !== "") out.push({ row: r, col: c, text });
    });
  });
  return out;
}

export function findLabel(cells: { row: number; col: number; text: string }[], label: string): CellPos | null {
  const want = label.toUpperCase();
  const hit = cells.find((c) => c.text.replace(/\s+/g, " ").toUpperCase() === want);
  return hit ? { row: hit.row, col: hit.col } : null;
}

/** "WEFT NO 6037" / "DOBBY NO BEZ" gibi serbest metinden değer. */
export function findPrefixed(cells: { text: string }[], prefix: string): string {
  const re = new RegExp(`^${prefix}\\s*[:]?\\s*(.+)$`, "i");
  for (const c of cells) {
    const m = re.exec(c.text);
    if (m) return (m[1] as string).trim();
  }
  return "";
}

const LETTER = /^[A-F]$/;

/** Lejant: tek harfli hücrenin sağındaki metin iplik adıdır (A → 70/800 TERGAL). */
export function readWeftMap(ws: Worksheet, cells: { row: number; col: number; text: string }[], maxRow: number) {
  const map: Record<string, string> = {};
  for (const c of cells) {
    if (c.row >= maxRow || !LETTER.test(c.text)) continue;
    const right = cellText(ws.getRow(c.row).getCell(c.col + 1));
    if (right !== "" && !/^\d+(\.\d+)?$/.test(right) && !LETTER.test(right) && !(c.text in map)) map[c.text] = right;
  }
  return map;
}

/** Atkı sırası: harflerin en yoğun olduğu sütun; bitişik sayı sütunu tekrar adedidir ("A3 B1"). */
export function readWeftSequence(ws: Worksheet, cells: { row: number; col: number; text: string }[], maxRow: number) {
  const counts = new Map<number, number>();
  for (const c of cells) if (c.row < maxRow && LETTER.test(c.text)) counts.set(c.col, (counts.get(c.col) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return "";
  const col = best[0];
  const countCols = firstIndexCol(cells, col) === col - 1 ? [col + 1] : [col + 1, col - 1];
  const seq = cells
    .filter((c) => c.col === col && c.row < maxRow && LETTER.test(c.text))
    .sort((a, b) => a.row - b.row)
    .map((c) => {
      const texts = countCols.map((k) => cellText(ws.getRow(c.row).getCell(k)));
      const count = texts.find((t) => /^\d+(\.0)?$/.test(t));
      return `${c.text}${count ? String(Number(count)) : ""}`;
    });
  return seq.join(" ");
}

/** Harf sütununun solundaki 1,2,3… sıra numarası sütunu (tekrar adedi sanılmasın). */
function firstIndexCol(cells: { row: number; col: number; text: string }[], letterCol: number): number {
  const candidates = [letterCol - 1, letterCol - 2];
  for (const col of candidates) {
    const nums = cells.filter((c) => c.col === col).map((c) => Number(c.text));
    if (nums.length >= 3 && nums.slice(0, 3).every((n, i) => n === i + 1)) return col;
  }
  return -1;
}

function isFilled(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (!fill || fill.type !== "pattern" || fill.pattern === "none") return false;
  const argb = fill.fgColor?.argb;
  return argb === undefined || !/^(FF)?FFFFFF$/i.test(argb);
}

/**
 * Armür ızgarası: 1,2,3… çerçeve başlığı (≥4 ardışık) altında boyalı hücre = 1.
 * Okunamazsa "" döner (uyarı, ret değil — tasarım §9.9 risk 2).
 */
export function readLiftPlan(ws: Worksheet, cells: { row: number; col: number; text: string }[], maxRow: number) {
  const byRow = new Map<number, { col: number; n: number }[]>();
  for (const c of cells) {
    if (c.row >= maxRow || !/^\d+(\.0)?$/.test(c.text)) continue;
    byRow.set(c.row, [...(byRow.get(c.row) ?? []), { col: c.col, n: Number(c.text) }]);
  }
  for (const [row, list] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = list.sort((a, b) => a.col - b.col);
    for (let start = 0; start < sorted.length; start++) {
      const run = consecutiveRun(sorted, start);
      if (run.length >= 4) return gridBits(ws, row, run, maxRow);
    }
  }
  return "";
}

/** `start`tan itibaren bitişik sütunlarda 1,2,3… dizisi (sıra no sütunu tek başına sayılmaz). */
function consecutiveRun(sorted: { col: number; n: number }[], start: number): number[] {
  const first = sorted[start];
  if (!first || first.n !== 1) return [];
  const cols = [first.col];
  let last = first;
  for (const x of sorted.slice(start + 1)) {
    if (x.col !== last.col + 1 || x.n !== last.n + 1) break;
    cols.push(x.col);
    last = x;
  }
  return cols;
}

function gridBits(ws: Worksheet, headerRow: number, cols: number[], maxRow: number): string {
  const lines: string[] = [];
  for (let r = headerRow + 1; r < maxRow; r++) {
    const bits = cols.map((c) => (isFilled(ws.getRow(r).getCell(c)) ? "1" : "0")).join("");
    if (bits.includes("1")) lines.push(bits);
  }
  return lines.join(";");
}

/** Varyant listesi: "V01" hücresi + sağında sim rengi, boya prosesi, sim iplik kodu. */
export function readVariants(ws: Worksheet, cells: { row: number; col: number; text: string }[]): Variant[] {
  const seen = new Set<string>();
  const out: Variant[] = [];
  for (const c of cells) {
    if (!/^V\d{2,3}$/i.test(c.text)) continue;
    const code = c.text.toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    const row = ws.getRow(c.row);
    const extra = [3, 4].map((d) => cellText(row.getCell(c.col + d))).find((t) => t !== "") ?? "";
    out.push({
      code,
      metallic: cellText(row.getCell(c.col + 1)),
      dyeProcess: cellText(row.getCell(c.col + 2)),
      metallicYarnCode: extra,
    });
  }
  return out;
}
