import type { Column, Row, RowData, Table } from "@tanstack/react-table";

// Kolon meta'sını genişlet: dışa aktarma için özel değer + okunur etiket.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** CSV/etiket için okunur sütun adı (header bir bileşense). */
    label?: string;
    /** Türetilmiş/iç içe kolonlar için CSV değeri. */
    exportValue?: (row: TData) => unknown;
  }
}

/** Sütun için insan-okunur etiket: meta.label → string header → id. */
export function columnLabel<T>(col: Column<T, unknown>): string {
  const label = col.columnDef.meta?.label;
  if (label) return label;
  const h = col.columnDef.header;
  if (typeof h === "string" && h.trim()) return h;
  return col.id;
}

// Bir nesneden okunur ad çıkar (item/color/property gibi ilişkili kayıtlar için).
function pickName(o: Record<string, unknown>): string {
  for (const k of ["name", "code", "label", "title", "fullName", "username"]) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  for (const k of ["property", "color", "item", "customer", "station", "branch"]) {
    const nested = o[k];
    if (nested && typeof nested === "object") {
      const n = pickName(nested as Record<string, unknown>);
      if (n) return n;
    }
  }
  return "";
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join(", ");
  if (typeof v === "object") return pickName(v as Record<string, unknown>);
  return String(v);
}

function cellExportValue<T>(col: Column<T, unknown>, row: Row<T>): string {
  const exportValue = col.columnDef.meta?.exportValue;
  if (exportValue) return toText(exportValue(row.original));
  let v: unknown;
  try {
    v = row.getValue(col.id);
  } catch {
    v = undefined;
  }
  // Görüntü kolonu (accessor yok) → row.original'daki aynı isimli alana düş.
  if (v === undefined || v === null) {
    v = (row.original as Record<string, unknown>)?.[col.id];
  }
  return toText(v);
}

function csvCell(s: string): string {
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Yüklü satırları (cursor sayfalamada bellekteki) görünür sütunlarla CSV'ye
 * aktarır. Excel-TR uyumu için `;` ayraç + UTF-8 BOM. select/actions hariç.
 */
export function exportTableToCsv<T>(table: Table<T>, filename = "tablo", onlyRows?: Row<T>[]): void {
  const cols = table
    .getVisibleLeafColumns()
    .filter((c) => c.id !== "select" && c.id !== "actions");

  const sourceRows = onlyRows ?? table.getRowModel().rows;
  const header = cols.map((c) => csvCell(columnLabel(c))).join(";");
  const rows = sourceRows.map((row) => cols.map((c) => csvCell(cellExportValue(c, row))).join(";"));

  const csv = "﻿" + [header, ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
