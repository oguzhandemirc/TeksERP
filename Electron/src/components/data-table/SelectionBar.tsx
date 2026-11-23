import type { ReactNode } from "react";
import type { Table as TanstackTable } from "@tanstack/react-table";
import { Download, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTableExportDialog } from "./export-dialog/useTableExportDialog";

interface Props<T> {
  table: TanstackTable<T>;
  selected: T[];
  bulkActions?: (rows: T[]) => ReactNode;
  selectionHint?: ReactNode;
  exportName: string;
  selectedExportHint?: string;
}

/**
 * Seçim çubuğu: DataTable yalnız seçim varken çizer (kullanıcı 2026-11-23). Sol slot "N seçili + Seçimi temizle",
 * ardından toplu eylemler, sağda seçili dışa aktarma. 0 dalı (ipucu) bileşeni doğrudan kullanan yerler içindir.
 */
export function SelectionBar<T>({ table, selected, bulkActions, selectionHint, exportName, selectedExportHint }: Props<T>) {
  // Seçili dışa aktarım da ortak diyalogdan geçer (biçim + sütun seçimi; kapsam "Seçili satırlar" ile açılır).
  const exp = useTableExportDialog({ table, exportName });
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
            {exp.dialog}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" title={selectedExportHint ?? "Seçili satırları dosyaya aktar (biçim ve sütunlar seçilir)"} disabled={exp.busy} onClick={() => exp.open("selected")}>
              <Download className="h-3.5 w-3.5" />
              Seçilileri dışa aktar
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
