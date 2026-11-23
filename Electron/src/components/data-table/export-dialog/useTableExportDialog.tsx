import { useState, type ReactNode } from "react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { exportListName, exportTableAs, tableExportCatalog } from "@/lib/table-export";
import { useExportRange } from "@/hooks/useExportRange";
import { useExportConfirm } from "@/hooks/useExportConfirm";
import { isExportCancelled, truncatedExportNote } from "@/lib/export-drain";
import { formatQty } from "@/lib/format";
import type { ExportScope } from "@/lib/export-columns";
import { ExportDialog, type ExportDialogChoice, type ExportScopeOption } from "./ExportDialog";

export type TableFetchAll<T> = (
  onProgress?: (loaded: number, total?: number) => void,
  onTruncated?: (loaded: number) => void,
  confirmTotal?: (total: number) => Promise<boolean>,
) => Promise<T[]>;

/** Kapsam → satırlar. "all" fetchAll ile liste ucunun AYNI süzgeciyle sunucudaki tümü (ekranla tek where). */
export async function rowsForScope<T>(
  table: Table<T>,
  scope: ExportScope,
  fetchAll: TableFetchAll<T> | undefined,
  hooks: Parameters<TableFetchAll<T>>,
): Promise<T[]> {
  if (scope === "selected") return table.getSelectedRowModel().rows.map((r) => r.original);
  if (scope === "all" && fetchAll) return fetchAll(...hooks);
  return table.getRowModel().rows.map((r) => r.original);
}

/**
 * Tablo listesinin çıktı diyaloğu: `open(kapsam?)` diyaloğu açar, `dialog` sayfa ağacında çizilir.
 * DataTableExportMenu ("Dışa aktar"), seçim çubuğu ve "Tümünü İndir" aynı kancayı kullanır — üç giriş, tek üretim.
 */
export function useTableExportDialog<T>(opts: {
  table: Table<T>;
  exportName: string;
  fetchAll?: TableFetchAll<T>;
  extras?: ReactNode;
}): {
  open: (scope?: ExportScope) => void;
  close: () => void;
  dialog: ReactNode;
  busy: boolean;
  busyLabel: string | undefined;
} {
  const { table, exportName, fetchAll } = opts;
  const [openScope, setOpenScope] = useState<ExportScope | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const range = useExportRange();
  const { confirmTotal, confirmDialog } = useExportConfirm();

  const selectedCount = openScope ? table.getSelectedRowModel().rows.length : 0;
  const loadedCount = openScope ? table.getRowModel().rows.length : 0;
  const scopes: ExportScopeOption[] = [
    fetchAll
      ? { key: "all", label: "Filtreye uyan tüm kayıtlar" }
      : { key: "loaded", label: "Ekrandaki kayıtlar", count: loadedCount },
    { key: "selected", label: "Seçili satırlar", count: selectedCount, disabled: selectedCount === 0 },
  ];

  const run = async (choice: ExportDialogChoice): Promise<boolean> => {
    setBusy(true);
    setProgress(null);
    try {
      const rows = await rowsForScope(table, choice.scope, fetchAll, [
        (loaded, total) => setProgress({ loaded, total }),
        (loaded) => toast.warning(truncatedExportNote(loaded), { duration: 12000 }),
        confirmTotal,
      ]);
      if (rows.length === 0) {
        toast.info("İndirilecek kayıt yok.");
        return false;
      }
      const name = exportListName(exportName, { range, selected: choice.scope === "selected" });
      await exportTableAs(choice.format, table, rows, name, choice.columns);
      return true;
    } catch (err) {
      if (!isExportCancelled(err)) toast.error("İndirme hazırlanamadı.");
      return false;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const busyLabel = progress
    ? `${formatQty(progress.loaded)}${progress.total ? ` / ~${formatQty(progress.total)}` : ""} indiriliyor…`
    : undefined;

  const dialog = (
    <>
      {confirmDialog}
      <ExportDialog
        open={openScope !== null}
        onOpenChange={(o) => !o && setOpenScope(null)}
        title={`Dışa aktar — ${exportName}`}
        info="Satırlar ekrandaki filtre ve sıralamayla aynıdır; Excel, PDF ve CSV aynı değerleri taşır. Ekranda gizli sütunlar listede işaretsiz gelir, işaretleyerek dosyaya ekleyebilirsiniz."
        catalog={openScope ? tableExportCatalog(table) : []}
        scopes={scopes}
        defaultScope={openScope ?? undefined}
        prefKey={`liste:${exportName}`}
        extras={opts.extras}
        busyLabel={busyLabel}
        onRun={run}
      />
    </>
  );

  return { open: (scope) => setOpenScope(scope ?? scopes[0]!.key), close: () => setOpenScope(null), dialog, busy, busyLabel };
}
