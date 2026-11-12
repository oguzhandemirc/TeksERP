import type { ReactNode } from "react";
import type { Table as TanstackTable } from "@tanstack/react-table";
import { FileSpreadsheet, FileText, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportTableToPdf, exportTableToXlsx, exportListName } from "@/lib/table-export";
import { cn } from "@/lib/utils";

interface Props<T> {
  table: TanstackTable<T>;
  selected: T[];
  bulkActions?: (rows: T[]) => ReactNode;
  selectionHint?: ReactNode;
  exportName: string;
  selectedExportHint?: string;
}

/**
 * Seçim çubuğu kalıcı: satır varsa (ve seçim açıksa) hep görünür. İKİ DURUMDA AYNI İSKELET (saha 2026-09-22:
 * "aktif/pasif arasında çok yer değiştiriyor"): sol slot "N seçili + Seçimi temizle" (0'da pasif, genişlik sabit),
 * hemen ardından toplu eylemler (0'da pasif), sağ slot ipucu (0) ↔ dışa aktarma (seçim).
 */
export function SelectionBar<T>({ table, selected, bulkActions, selectionHint, exportName, selectedExportHint }: Props<T>) {
  const fileName = exportListName(exportName, { selected: true });
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2 text-sm", selected.length > 0 ? "bg-primary/5" : "bg-muted/40")}>
      <span className={cn("min-w-[4.5rem] font-medium tabular-nums", selected.length === 0 && "text-muted-foreground")}>
        {selected.length} seçili
      </span>
      <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={selected.length === 0} onClick={() => table.resetRowSelection()}>
        <X className="h-3.5 w-3.5" />
        Seçimi temizle
      </Button>
      {bulkActions?.(selected)}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {selected.length > 0 ? (
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" title={selectedExportHint} onClick={() => void exportTableToPdf(table, selected, fileName)}>
              <FileText className="h-3.5 w-3.5 text-destructive" />
              Seçili PDF
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" title={selectedExportHint} onClick={() => void exportTableToXlsx(table, selected, fileName)}>
              <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
              Seçili Excel
            </Button>
          </>
        ) : selectionHint ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {selectionHint}
          </span>
        ) : null}
      </div>
    </div>
  );
}
