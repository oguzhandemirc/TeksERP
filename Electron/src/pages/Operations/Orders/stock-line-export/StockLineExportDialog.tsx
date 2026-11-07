import { useEffect, useState, type ReactNode } from "react";
import { FileSpreadsheet, Info, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/**
 * "Excel (stok kalemi bazında)…" — ayrım + sütun + satır süzgeci seçilir; son seçim kullanıcı
 * tercihinde kalır, bir dahaki açılışta hazır gelir. Küme ekrandaki süzgeçle aynıdır.
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
  const { run, progress } = useStockLineExportRun(props);

  // Her açılışta kayıtlı seçimle başla (tercih geç yüklenirse de yakala).
  useEffect(() => {
    if (props.open) setDraft(options);
  }, [props.open, options]);

  const cols = availableColumns(props.productionEnabled);
  const chosen = draft.columns.filter((c) => cols.some((x) => x.key === c));
  const toggleCol = (k: StockLineColumn, on: boolean) =>
    setDraft((d) => ({ ...d, columns: sortColumns(on ? [...d.columns, k] : d.columns.filter((c) => c !== k)) }));

  const submit = async () => {
    const next = { ...draft, columns: chosen };
    save(next);
    if (await run(next)) props.onOpenChange(false);
  };

  return (
    <>
      <Dialog open={props.open} onOpenChange={(o) => progress === null && props.onOpenChange(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Excel — stok kalemi bazında</DialogTitle>
            <DialogDescription>
              Ekrandaki süzgece uyan siparişler kumaş ve renge göre tek satırda toplanır: ne kadar sipariş var, ne kadarı
              açık, ne kadar daha üretilmeli.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-4">
              <Section title="Ayrım">
                <Check checked disabled>Kumaş (stok kartı)</Check>
                <Check checked={draft.byColor} onChange={(v) => setDraft((d) => ({ ...d, byColor: v }))}>Renk</Check>
                <Check checked={draft.byWidth} onChange={(v) => setDraft((d) => ({ ...d, byWidth: v }))}>En</Check>
                <p className="flex gap-1.5 px-2 pt-1 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Birim her zaman ayrı tutulur: metre ile kg asla toplanmaz.
                </p>
              </Section>
              <Section title="Satırlar">
                <Check checked={draft.onlyOpen} onChange={(v) => setDraft((d) => ({ ...d, onlyOpen: v }))}>
                  Yalnız açığı olanlar
                </Check>
              </Section>
            </div>
            <Section title="Sütunlar">
              {cols.map((c) => (
                <Check key={c.key} checked={chosen.includes(c.key)} onChange={(v) => toggleCol(c.key, v)}>
                  {c.label}
                </Check>
              ))}
            </Section>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={progress !== null} onClick={() => props.onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button disabled={progress !== null || chosen.length === 0 || !ready} onClick={() => void submit()}>
              {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {progress ?? "Excel oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
