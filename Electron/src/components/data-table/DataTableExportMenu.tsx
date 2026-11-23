import type { ReactNode } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { useTableExportDialog, type TableFetchAll } from "./export-dialog/useTableExportDialog";

export type { TableFetchAll } from "./export-dialog/useTableExportDialog";

/** Ekranın kendi dışa aktarma seçeneği (ör. Siparişler "Excel (stok kalemi bazında)…"). */
export interface ExtraExportOption {
  key: string;
  label: string;
  /** Madde ipucu — ne indirdiğini söyler. */
  title?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

/**
 * "Dışa aktar" — ortak çıktı diyaloğunu açar (biçim · kapsam · sütunlar). `fetchAll` verilirse kapsam
 * "filtreye uyan tüm kayıtlar" (sektör standardı), yoksa ekrandaki satırlar; seçim varsa "seçili satırlar".
 * Ekranın ek çıktıları diyaloğun altında düğme olarak durur.
 */
export function DataTableExportMenu<T>({
  table,
  exportName = "Liste",
  fetchAll,
  extraExports,
  compact,
}: {
  table: Table<T>;
  exportName?: string;
  fetchAll?: TableFetchAll<T>;
  extraExports?: ExtraExportOption[];
  /** 2xl altında yazı düşer (simge kalır); indirme sürerken sayaç yine görünür. */
  compact?: boolean;
}) {
  const extras = extraExports?.length
    ? extraExports.map((x) => (
        <Button key={x.key} type="button" variant="outline" size="sm" className="h-8 gap-1.5" title={x.title} onClick={() => { exp.close(); x.onSelect(); }}>
          {x.icon ?? <FileSpreadsheet className="h-4 w-4 text-success" />} {x.label}
        </Button>
      ))
    : undefined;
  const exp = useTableExportDialog({ table, exportName, fetchAll, extras });
  const label = exp.busy ? exp.busyLabel ?? "Hazırlanıyor…" : "Dışa aktar";
  const scope = fetchAll ? "filtreye uyan tüm kayıtlar" : "ekrandaki kayıtlar";

  return (
    <>
      {exp.dialog}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        disabled={exp.busy}
        onClick={() => exp.open()}
        title={`Listeyi dosyaya aktar (${scope}; biçim ve sütunlar seçilir)`}
        aria-label={compact && !exp.busy ? "Dışa aktar" : undefined}
      >
        {exp.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        <span className={compact && !exp.busy ? "hidden 2xl:inline" : undefined}>{label}</span>
      </Button>
    </>
  );
}
