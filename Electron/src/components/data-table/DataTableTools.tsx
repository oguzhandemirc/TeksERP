import { Download, Settings2 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { columnLabel, exportTableToCsv } from "@/lib/table-export";

interface Props<T> {
  table: Table<T>;
  /** CSV dosya adı. */
  exportName?: string;
}

/**
 * Tablo araçları — sütun göster/gizle (localStorage'de kalıcı, useDataTable)
 * ve yüklü satırları CSV'ye aktarma.
 */
export function DataTableTools<T>({ table, exportName = "tablo" }: Props<T>) {
  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== "select" && c.id !== "actions");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" title="Sütunlar & dışa aktar">
          <Settings2 className="h-3.5 w-3.5" />
          Sütunlar
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2">
        <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Görünür Sütunlar</p>
        <ul className="max-h-64 space-y-0.5 overflow-y-auto">
          {hideable.map((col) => (
            <li key={col.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent">
                <Checkbox
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                />
                <span className="truncate">{columnLabel(col)}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => exportTableToCsv(table, exportName)}
          >
            <Download className="h-3.5 w-3.5" />
            CSV indir
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
