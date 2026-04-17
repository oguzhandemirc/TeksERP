import { Download, FileSpreadsheet, FileText } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { exportToExcel, exportToCsv } from "@/lib/export-utils";

export interface ExportColumn<TData = Record<string, unknown>> {
  header: string;
  accessor: string | ((row: TData) => string);
}

interface DataTableExportProps<TData> {
  data: TData[];
  selectedData?: TData[];
  columns: ExportColumn<TData>[];
  filename: string;
}

function resolveColumns<TData>(
  columns: ExportColumn<TData>[],
): { header: string; accessorKey: string }[] {
  return columns.map((col) => ({ header: col.header, accessorKey: col.header }));
}

function mapData<TData>(
  data: TData[],
  columns: ExportColumn<TData>[],
): Record<string, unknown>[] {
  return data.map((row) => {
    const mapped: Record<string, unknown> = {};
    for (const col of columns) {
      if (typeof col.accessor === "function") {
        mapped[col.header] = col.accessor(row);
      } else {
        mapped[col.header] = (row as Record<string, unknown>)[col.accessor] ?? "";
      }
    }
    return mapped;
  });
}

function DataTableExport<TData>({
  data,
  selectedData,
  columns,
  filename,
}: DataTableExportProps<TData>) {
  const hasSelection = selectedData && selectedData.length > 0;
  const exportCols = resolveColumns(columns);

  const handleExcelAll = () => exportToExcel(mapData(data, columns), exportCols, filename);
  const handleCsvAll = () => exportToCsv(mapData(data, columns), exportCols, filename);
  const handleExcelSelected = () => {
    if (selectedData) exportToExcel(mapData(selectedData, columns), exportCols, `${filename}_secili`);
  };
  const handleCsvSelected = () => {
    if (selectedData) exportToCsv(mapData(selectedData, columns), exportCols, `${filename}_secili`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center justify-center gap-2 rounded-md border border-input bg-background px-3 h-10 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
        <Download className="h-4 w-4" />
        Dışa Aktar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Tüm Veriler ({data.length})</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleExcelAll}>
          <FileSpreadsheet className="h-4 w-4" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleCsvAll}>
          <FileText className="h-4 w-4" />
          CSV
        </DropdownMenuItem>

        {hasSelection && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              Seçili ({selectedData.length})
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={handleExcelSelected}>
              <FileSpreadsheet className="h-4 w-4" />
              Excel (.xlsx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCsvSelected}>
              <FileText className="h-4 w-4" />
              CSV
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default DataTableExport;
