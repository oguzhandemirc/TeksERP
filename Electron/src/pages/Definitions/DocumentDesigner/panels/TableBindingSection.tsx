import { useState } from "react";
import type { Component } from "grapesjs";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { isFieldLocked, type ContractColumn, type ContractView } from "../binding/contract";
import { defaultColumns, itemTableInner, moveColumn, tableBindingsFromHtml, toggleColumn } from "../binding/itemTable";
import { InternalConfirmDialog } from "../modals/InternalConfirmDialog";
import { TableSourceModal } from "../modals/TableSourceModal";
import { Section } from "./Section";

interface Props {
  table: Component;
  contract: ContractView;
  internalFields: readonly string[];
  onOpenInternal: (code: string) => void;
  onChange: () => void;
}

/** Kalem tablosu: `data-each` kaynağı (yalnız `tablolar.*`) + kolon ekle/çıkar/sırala → `tableBindings`. */
export function TableBindingSection({ table, contract, internalFields, onOpenInternal, onChange }: Props) {
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<ContractColumn | null>(null);
  const key = String(table.getAttributes()["data-tablo"] ?? "");
  const def = contract.tablolar.find((t) => t.anahtar === key);
  const columns = tableBindingsFromHtml(table.toHTML())[key]?.kolonlar ?? [];

  const rebuild = (tableKey: string, cols: string[]) => {
    const t = contract.tablolar.find((x) => x.anahtar === tableKey);
    if (!t) return;
    table.addAttributes({ "data-tablo": tableKey });
    table.components(itemTableInner(t, cols));
    onChange();
  };
  const toggle = (k: ContractColumn) => {
    if (!columns.includes(k.yol) && isFieldLocked(k, internalFields)) {
      setConfirm(k);
      return;
    }
    if (def) rebuild(key, toggleColumn(def, columns, k.yol));
  };

  return (
    <Section title="Kalem tablosu" testId="kalem-tablosu-ozellik">
      <div className="text-xs">
        <span className="text-muted-foreground">Kaynak: </span>
        <span className="font-medium">{def?.etiket ?? "seçilmedi"}</span>
        {def && <span className="ml-1 font-mono text-muted-foreground">tablolar.{def.anahtar}</span>}
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setPicking(true)}>Kaynak seç…</Button>
      {def && (
        <ul className="space-y-0.5" aria-label="Kolonlar">
          {def.kolonlar.map((k) => {
            const on = columns.includes(k.yol);
            const locked = !on && isFieldLocked(k, internalFields);
            const i = columns.indexOf(k.yol);
            return (
              <li key={k.yol} className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={on} onCheckedChange={() => toggle(k)} aria-label={k.etiket} />
                <span className={`flex-1 truncate ${locked ? "text-muted-foreground" : ""}`}>{k.etiket}</span>
                {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="İç kolon — kilitli" />}
                {on && (
                  <>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Yukarı" disabled={i === 0} onClick={() => rebuild(key, moveColumn(columns, k.yol, -1))}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0" aria-label="Aşağı" disabled={i === columns.length - 1} onClick={() => rebuild(key, moveColumn(columns, k.yol, 1))}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {columns.length > 0 && def && (
        <p className="text-[11px] text-muted-foreground">Sıra: {columns.map((c) => def.kolonlar.find((k) => k.yol === c)?.etiket ?? c).join(" › ")}</p>
      )}
      <TableSourceModal open={picking} onOpenChange={setPicking} contract={contract} current={def?.anahtar ?? null} onPick={(t) => {
        const next = contract.tablolar.find((x) => x.anahtar === t);
        if (next) rebuild(t, defaultColumns(next, internalFields));
      }} />
      <InternalConfirmDialog
        label={confirm?.etiket ?? null}
        customerFacing={contract.hedef === "musteri"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.icKod && def) {
            onOpenInternal(confirm.icKod);
            rebuild(key, toggleColumn(def, columns, confirm.yol));
          }
          setConfirm(null);
        }}
      />
    </Section>
  );
}
