import * as XLSX from "xlsx";

interface ExportColumn {
  header: string;
  accessorKey: string;
}

export function exportToExcel<TData extends Record<string, unknown>>(
  data: TData[],
  columns: ExportColumn[],
  filename: string,
) {
  const rows = data.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      obj[col.header] = row[col.accessorKey];
    }
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(rows);

  const colWidths = columns.map((col) => ({
    wch: Math.max(
      col.header.length,
      ...data.map((row) => String(row[col.accessorKey] ?? "").length),
      10,
    ),
  }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Veri");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToCsv<TData extends Record<string, unknown>>(
  data: TData[],
  columns: ExportColumn[],
  filename: string,
) {
  const headers = columns.map((c) => c.header).join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const val = String(row[col.accessorKey] ?? "");
        return val.includes(",") || val.includes('"') || val.includes("\n")
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      })
      .join(","),
  );

  const csvContent = [headers, ...rows].join("\n");
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
