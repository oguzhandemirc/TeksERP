import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContractView } from "../binding/contract";
import { buildCondition, CONDITION_LITERALS, CONDITION_OPERATORS, parseCondition, type ConditionRow } from "../binding/directives";
import { FieldPickerModal, type PickerScope } from "./FieldPickerModal";

const EMPTY_ROW: ConditionRow = { join: "and", path: "", op: "", valueKind: "metin", value: "" };
const sel = "h-8 rounded-md border border-input bg-background px-1.5 text-xs";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: string;
  contract: ContractView;
  scope: PickerScope;
  internalFields: readonly string[];
  onOpenInternal: (code: string) => void;
  onApply: (value: string) => void;
}

interface RowProps {
  row: ConditionRow;
  index: number;
  single: boolean;
  onPatch: (p: Partial<ConditionRow>) => void;
  onPick: () => void;
  onRemove: () => void;
}

/** Tek satır: bağlaç · alan (modal) · karşılaştırma · değer türü · değer. */
function ConditionRowEditor({ row: r, index: i, single, onPatch, onPick, onRemove }: RowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {i === 0 ? (
        <span className="w-16 text-xs text-muted-foreground">Eğer</span>
      ) : (
        <select aria-label="Bağlaç" className={`${sel} w-16`} value={r.join} onChange={(e) => onPatch({ join: e.target.value as "and" | "or" })}>
          <option value="and">ve</option>
          <option value="or">veya</option>
        </select>
      )}
      <Button type="button" size="sm" variant="outline" className="h-8 max-w-[220px] truncate font-mono text-xs" onClick={onPick}>
        {r.path || "Alan seç…"}
      </Button>
      <select aria-label="Karşılaştırma" className={sel} value={r.op} onChange={(e) => onPatch({ op: e.target.value as ConditionRow["op"] })}>
        <option value="">dolu ise</option>
        {CONDITION_OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {r.op && (
        <>
          <select aria-label="Değer türü" className={sel} value={r.valueKind} onChange={(e) => onPatch({ valueKind: e.target.value as ConditionRow["valueKind"], value: e.target.value === "sabit" ? "true" : "" })}>
            <option value="metin">metin</option>
            <option value="sayi">sayı</option>
            <option value="sabit">sabit</option>
          </select>
          {r.valueKind === "sabit" ? (
            <select aria-label="Sabit değer" className={sel} value={r.value} onChange={(e) => onPatch({ value: e.target.value })}>
              {CONDITION_LITERALS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <Input aria-label="Değer" className="h-8 w-32 text-xs" value={r.value} onChange={(e) => onPatch({ value: e.target.value })} />
          )}
        </>
      )}
      <Button type="button" size="sm" variant="ghost" aria-label="Satırı sil" disabled={single} onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** `data-if` kurucusu: yol · op · değer satırları + ve/veya; parantez yok (dilbilgisi §5). */
export function ConditionBuilderModal({ open, onOpenChange, initial, contract, scope, internalFields, onOpenInternal, onApply }: Props) {
  const [rows, setRows] = useState<ConditionRow[]>([EMPTY_ROW]);
  const [pickFor, setPickFor] = useState<number | null>(null);
  useEffect(() => {
    if (open) setRows(parseCondition(initial) ?? [{ ...EMPTY_ROW }]);
  }, [open, initial]);
  const result = buildCondition(rows);
  const set = (i: number, patch: Partial<ConditionRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Koşul kur</DialogTitle>
          <DialogDescription>Öğe yalnız koşul doğruysa basılır. Satırlar soldan sağa “ve / veya” ile bağlanır; parantez yoktur.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2" data-testid="kosul-satirlari">
          {rows.map((r, i) => (
            <ConditionRowEditor key={i} row={r} index={i} single={rows.length === 1} onPatch={(p) => set(i, p)} onPick={() => setPickFor(i)} onRemove={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW }])}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Satır ekle
          </Button>
        </div>
        <div className="rounded border bg-muted/40 px-3 py-2 text-xs">
          {result.ok ? (
            <span>data-if = <code className="font-mono">{result.value}</code></span>
          ) : (
            <span className="text-destructive">{result.error}</span>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!result.ok} onClick={() => { if (result.ok) { onApply(result.value); onOpenChange(false); } }}>Uygula</Button>
        </DialogFooter>
        {pickFor !== null && (
          <FieldPickerModal
            open
            onOpenChange={(o) => { if (!o) setPickFor(null); }}
            contract={contract}
            scope={scope}
            internalFields={internalFields}
            onOpenInternal={onOpenInternal}
            onPick={(path) => set(pickFor, { path })}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
