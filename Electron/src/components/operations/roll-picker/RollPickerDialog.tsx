// Çoklu top seçici (ortak) — doğrudan modal, kaydırılabilir tam liste, arama ve TEK açılır filtre.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listPickableRolls, type PickedRoll } from "./pickable-rolls";
import { RollChecklist, toggleInSet } from "./RollChecklist";

export interface RollPickerScope {
  key: string;
  label: string;
  /** `/api/rolls` süzgeçleri (`filter[...]`). */
  filters: Record<string, string>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Açılır filtrenin seçenekleri; ilki varsayılan. */
  scopes: RollPickerScope[];
  /** Zaten seçili olanlar — listede gösterilmez. */
  excludeIds?: string[];
  confirmLabel?: string;
  onConfirm: (rolls: PickedRoll[]) => void;
}

export function RollPickerDialog({ open, onOpenChange, title, description, scopes, excludeIds = [], confirmLabel = "Ekle", onConfirm }: Props) {
  const [scopeKey, setScopeKey] = useState(scopes[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const scope = scopes.find((s) => s.key === scopeKey) ?? scopes[0];
  const q = useQuery({
    queryKey: ["roll-picker", scope?.filters, search],
    queryFn: () => listPickableRolls(scope?.filters ?? {}, { search: search || undefined }),
    enabled: open && Boolean(scope),
  });
  const rolls = (q.data ?? []).filter((r) => !excludeIds.includes(r.id));
  const confirm = () => {
    onConfirm(rolls.filter((r) => sel.has(r.id)));
    setSel(new Set());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Barkod / kumaş / renk ara..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {scopes.length > 1 ? (
            <Select value={scope?.key} onValueChange={(v) => { setScopeKey(v); setSel(new Set()); }}>
              <SelectTrigger className="w-44" aria-label="Kapsam"><SelectValue /></SelectTrigger>
              <SelectContent>
                {scopes.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <RollChecklist rolls={rolls} selected={sel} onToggle={(id) => setSel((s) => toggleInSet(s, id))} loading={q.isLoading} emptyText="Bu kapsamda uygun top yok." />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>İptal</Button>
          <Button disabled={sel.size === 0} onClick={confirm}>{`${confirmLabel} (${sel.size})`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
