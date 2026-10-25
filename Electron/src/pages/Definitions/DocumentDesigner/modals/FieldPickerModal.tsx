import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { lowerTr } from "@/lib/tr-case";
import { DOCUMENT_TEMPLATE_DESIGN } from "@/lib/permissions";
import { CUSTOMER_INTERNAL_WARNING, isFieldLocked, totalFields, type ContractField, type ContractView } from "../binding/contract";
import { FieldNodeRow } from "../panels/FieldNodeRow";

export type PickerScope = { kind: "all" } | { kind: "totals" } | { kind: "row"; variable: string; tableKey: string };

interface Option {
  path: string;
  label: string;
  group: string;
  field: ContractField;
}

/** Kapsama göre seçilebilir alanlar: satır içinde döngü değişkeninin kolonları + kök alanlar. */
export function pickerOptions(c: ContractView, scope: PickerScope): Option[] {
  if (scope.kind === "totals") return totalFields(c).map((f) => ({ path: f.yol, label: f.etiket, group: "Toplamlar", field: f }));
  const roots = c.kokler.map((f) => ({ path: f.yol, label: f.etiket, group: f.yol.split(".")[0] ?? "", field: f }));
  if (scope.kind !== "row") return roots;
  const t = c.tablolar.find((x) => x.anahtar === scope.tableKey);
  const cols = (t?.kolonlar ?? []).map((k) => ({ path: `${scope.variable}.${k.yol}`, label: k.etiket, group: `Satır (${t?.etiket ?? ""})`, field: k as ContractField }));
  return [...cols, ...roots];
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: ContractView;
  scope: PickerScope;
  internalFields: readonly string[];
  onOpenInternal: (code: string) => void;
  onPick: (path: string, field: ContractField) => void;
}

/** Alan seçici (UI kuralı: seçici doğrudan modal). İç alan kilitli; açmak onay ister. */
export function FieldPickerModal({ open, onOpenChange, contract, scope, internalFields, onOpenInternal, onPick }: Props) {
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<Option | null>(null);
  const canDesign = useRoleAccess().hasAnyPermission(DOCUMENT_TEMPLATE_DESIGN);
  const options = useMemo(() => {
    const needle = lowerTr(q.trim());
    const all = pickerOptions(contract, scope);
    return needle ? all.filter((o) => lowerTr(`${o.label} ${o.path}`).includes(needle)) : all;
  }, [contract, scope, q]);
  const groups = useMemo(() => [...new Set(options.map((o) => o.group))], [options]);

  const choose = (o: Option) => {
    if (isFieldLocked(o.field, internalFields)) {
      setConfirm(o);
      return;
    }
    onPick(o.path, o.field);
    onOpenChange(false);
  };
  const confirmOpen = () => {
    if (!confirm?.field.icKod) return;
    onOpenInternal(confirm.field.icKod);
    onPick(confirm.path, confirm.field);
    setConfirm(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setConfirm(null); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{confirm ? "İç alanı aç" : "Alan seç"}</DialogTitle>
          <DialogDescription>
            {confirm ? `"${confirm.label}" iç alandır; açılınca şablonun iç alan listesine eklenir.` : "Belgenin veri sözleşmesinden bir alan seçin."}
          </DialogDescription>
        </DialogHeader>
        {confirm ? (
          <div className="space-y-3">
            {contract.hedef === "musteri" && <Callout tone="warning" title="Müşteri belgesi">{CUSTOMER_INTERNAL_WARNING}</Callout>}
            {!canDesign && <p className="text-sm text-muted-foreground">İç alanı açmak için şablon tasarım yetkisi gerekir.</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>Vazgeç</Button>
              <Button disabled={!canDesign} onClick={confirmOpen}>İç alanı aç ve bağla</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-2">
            <Input autoFocus placeholder="Alan ara…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Alan ara" />
            <div className="max-h-[50vh] overflow-y-auto rounded border p-1">
              {groups.length === 0 && <p className="p-3 text-sm text-muted-foreground">Eşleşen alan yok.</p>}
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</div>
                  {options.filter((o) => o.group === g).map((o) => (
                    <FieldNodeRow key={o.path} label={o.label} path={o.path} field={o.field} locked={isFieldLocked(o.field, internalFields)} onClick={() => choose(o)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
