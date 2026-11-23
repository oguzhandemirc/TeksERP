import { useEffect, useState } from "react";
import type { Table } from "@tanstack/react-table";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ExportDialog, type ExportDialogChoice } from "@/components/data-table/export-dialog/ExportDialog";
import { useExportConfirm } from "@/hooks/useExportConfirm";
import { isExportCancelled } from "@/lib/export-drain";
import { tableExportCatalog } from "@/lib/table-export";
import {
  downloadInventorySummary,
  KALEM_CATALOG,
  KATEGORI_CATALOG,
  SUMMARY_DETAILS,
  type SummaryDetail,
  type SummaryTab,
} from "./inventorySummary";
import type { Roll } from "./types";

/**
 * "Kumaş Stoğu Özeti" — ayrıntı düzeyi (kategori toplamı · kalem kalem · top top) + kategori filtresi + sütunlar.
 * Rakamlar ekranla aynı where'den: kategori/kalem toplamı o sekmenin şerit rakamı, top top o sekmenin listesi.
 */
export function InventorySummaryDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: SummaryTab[];
  table: Table<Roll>;
}) {
  const { tabs, table } = props;
  const [picked, setPicked] = useState<string[]>([]);
  const { confirmTotal, confirmDialog } = useExportConfirm();

  // Her açılışta bütün kategoriler seçili başlar (ticaret rejiminde gizlenen sekme listede zaten yok).
  useEffect(() => {
    if (props.open) setPicked(tabs.map((t) => t.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız açılışta tohumlanır
  }, [props.open]);

  const toggle = (key: string, on: boolean) =>
    setPicked((cur) => tabs.filter((t) => (t.key === key ? on : cur.includes(t.key))).map((t) => t.key));

  const catalog = (detail: string | undefined) =>
    detail === "kalem" ? KALEM_CATALOG : detail === "top" ? tableExportCatalog(table) : KATEGORI_CATALOG;

  const run = async (c: ExportDialogChoice): Promise<boolean> => {
    try {
      const ok = await downloadInventorySummary({
        detail: (c.detail ?? "kategori") as SummaryDetail,
        format: c.format === "pdf" ? "pdf" : "xlsx",
        tabs: tabs.filter((t) => picked.includes(t.key)),
        columnIds: c.columns,
        table,
        confirmTotal,
      });
      if (ok) toast.success("Kumaş stoğu özeti indirildi.");
      return ok;
    } catch (err) {
      if (!isExportCancelled(err)) toast.error("Kumaş stoğu özeti oluşturulamadı.");
      return false;
    }
  };

  return (
    <>
      {confirmDialog}
      <ExportDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Kumaş Stoğu Özeti"
        info="Kategori toplamı her sekmenin şerit rakamını verir. Kalem kalem seçilen ayrıma göre (kumaş, renk, en…) toplar; top top her topu liste sütunlarıyla yazar. Kategoriler örtüşebildiği için kategori toplamında genel toplam yoktur."
        formats={["xlsx", "pdf"]}
        details={SUMMARY_DETAILS}
        catalog={catalog}
        prefKey="kumas-stogu-ozeti"
        canRun={picked.length > 0}
        onRun={run}
        filters={
          <div className="space-y-1">
            <div className="flex items-center justify-between px-0.5 text-xs text-muted-foreground">
              <span>Kategoriler ({picked.length}/{tabs.length})</span>
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setPicked(picked.length === tabs.length ? [] : tabs.map((t) => t.key))}>
                {picked.length === tabs.length ? "Hiçbiri" : "Tümü"}
              </Button>
            </div>
            <ul className="grid max-h-56 grid-cols-2 gap-0.5 overflow-y-auto rounded-md border bg-white p-1 dark:bg-background" aria-label="Kategoriler">
              {tabs.map((t) => (
                <li key={t.key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                    <Checkbox checked={picked.includes(t.key)} onCheckedChange={(v) => toggle(t.key, Boolean(v))} aria-label={t.label} />
                    <span className="truncate">{t.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        }
      />
    </>
  );
}
