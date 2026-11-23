import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ExportDialog } from "@/components/data-table/export-dialog/ExportDialog";
import type { ExportColumnOption } from "@/lib/export-columns";
import { availableColumns, sortColumns, type StockLineColumn, type StockLineOptions } from "./options";
import { useStockLineExportPrefs } from "./useStockLineExportPrefs";
import { useStockLineExportRun, type OrdersFetchAll } from "./useStockLineExportRun";
import type { OrderListScope } from "./scope-summary";

function Check(props: { checked: boolean; disabled?: boolean; onChange?: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent has-[:disabled]:cursor-default has-[:disabled]:opacity-70">
      <Checkbox checked={props.checked} disabled={props.disabled} onCheckedChange={(v) => props.onChange?.(Boolean(v))} />
      <span>{props.children}</span>
    </label>
  );
}

const SubTitle = ({ children }: { children: ReactNode }) => <p className="px-1 pt-1 text-xs text-muted-foreground">{children}</p>;

/**
 * "Siparişler — stok kalemi bazında" — ortak çıktı diyaloğu (Excel/PDF + sütun) ve bu çıktının süzgeçleri
 * (ayrım + satırlar). Son seçim kullanıcı tercihinde kalır (`prefs.orders.stockLineExport`): kayıtlı sütunlar
 * katalogda "işaretli" gelir. Küme ekrandaki süzgeçle aynıdır; Excel ve PDF aynı sayfadan üretilir.
 */
export function StockLineExportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchAll: OrdersFetchAll;
  listScope: OrderListScope;
  productionEnabled: boolean;
}) {
  const { options, save, ready } = useStockLineExportPrefs();
  const [draft, setDraft] = useState<StockLineOptions>(options);
  const { run, progress, confirmDialog } = useStockLineExportRun(props);

  // Her açılışta kayıtlı seçimle başla (tercih geç yüklenirse de yakala).
  useEffect(() => {
    if (props.open) setDraft(options);
  }, [props.open, options]);

  const catalog = useMemo<ExportColumnOption[]>(
    () => availableColumns(props.productionEnabled).map((c) => ({ id: c.key, label: c.label, visible: options.columns.includes(c.key) })),
    [props.productionEnabled, options.columns],
  );

  return (
    <>
      {confirmDialog}
      <ExportDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Siparişler — stok kalemi bazında"
        info="Ekrandaki filtreye uyan siparişler kumaş ve renge göre tek satırda toplanır: ne kadar sipariş var, ne kadarı açık, ne kadar daha üretilmeli."
        catalog={catalog}
        formats={["xlsx", "pdf"]}
        busyLabel={progress ?? undefined}
        canRun={ready}
        filters={
          <div className="space-y-1">
            <SubTitle>Ayrım</SubTitle>
            <Check checked disabled>Kumaş (stok kartı)</Check>
            <Check checked={draft.byColor} onChange={(v) => setDraft((d) => ({ ...d, byColor: v }))}>Renk</Check>
            <Check checked={draft.byWidth} onChange={(v) => setDraft((d) => ({ ...d, byWidth: v }))}>En</Check>
            <p className="flex gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Birim her zaman ayrı tutulur: metre ile kg asla toplanmaz.
            </p>
            <SubTitle>Satırlar</SubTitle>
            <Check checked={draft.onlyOpen} onChange={(v) => setDraft((d) => ({ ...d, onlyOpen: v }))}>
              Yalnız açığı olanlar
            </Check>
          </div>
        }
        onRun={async (c) => {
          const next: StockLineOptions = { ...draft, columns: sortColumns(c.columns as StockLineColumn[]) };
          save(next);
          return run(next, c.format === "pdf" ? "pdf" : "xlsx");
        }}
      />
    </>
  );
}
