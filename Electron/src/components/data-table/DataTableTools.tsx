import { Settings2 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { columnLabel } from "@/lib/table-export";
import { DataTableExportMenu, type ExtraExportOption, type TableFetchAll } from "./DataTableExportMenu";

export type { ExtraExportOption } from "./DataTableExportMenu";

interface Props<T> {
  table: Table<T>;
  /** İndirilen liste dosya adı tabanı (ör. "Sevkiyatlar"). Tarih otomatik eklenir. */
  exportName?: string;
  /** Verilirse indirme aktif filtre/aramaya uyan SUNUCUDAKİ TÜM kayıtları çeker
   *  (useDataTable.fetchAll); verilmezse yalnız bellekteki satırlar iner. */
  fetchAll?: TableFetchAll<T>;
  /** true → "Dışa aktar" menüsü çizilmez (indirme başka yerde görünür olduğunda çift olmasın). */
  hideExport?: boolean;
  /** Ekranın ek dışa aktarma seçenekleri — "Dışa aktar ▾" menüsünde Excel'in altında. */
  extraExports?: ExtraExportOption[];
  /** Tek satır filtre çubuğu: 2xl altında yazı düşer, simge kalır (kutulara yer). */
  compact?: boolean;
}

/**
 * Tablo araçları — "Sütunlar" (yalnız göster/gizle, kullanıcı tercihinde kalıcı) ve ayrı
 * "Dışa aktar ▾" menüsü (Excel · ek seçenekler · PDF · CSV). SAP Fiori/MUI deseni: görünürlük
 * ile dışa aktarma ayrı düğmelerdir (kullanıcı talebi 2026-11-07).
 */
export function DataTableTools<T>({ table, exportName = "Liste", fetchAll, hideExport, extraExports, compact }: Props<T>) {
  const hideable = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && c.id !== "select" && c.id !== "actions");

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" title="Görünür sütunlar" aria-label={compact ? "Sütunlar" : undefined}>
            <Settings2 className="h-3.5 w-3.5" />
            <span className={compact ? "hidden 2xl:inline" : undefined}>Sütunlar</span>
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
        </PopoverContent>
      </Popover>
      {!hideExport && (
        <DataTableExportMenu table={table} exportName={exportName} fetchAll={fetchAll} extraExports={extraExports} compact={compact} />
      )}
    </>
  );
}
