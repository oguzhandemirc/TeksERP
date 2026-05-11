import { useMemo, useState } from "react";
import { Search, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categoryLabels, moduleLabels, isWildcard, type Permission } from "@/types/permissions";

interface Props {
  permissions: Permission[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  emptyHint?: string;
}

export function PermissionGrid({ permissions, value, onChange, disabled, emptyHint }: Props) {
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const filtered = permissions.filter((p) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        p.code.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (moduleLabels[p.module] ?? p.module).toLowerCase().includes(q)
      );
    });

    const byCat = new Map<string, Map<string, Permission[]>>();
    for (const p of filtered) {
      const cat = byCat.get(p.category) ?? new Map<string, Permission[]>();
      const list = cat.get(p.module) ?? [];
      list.push(p);
      cat.set(p.module, list);
      byCat.set(p.category, cat);
    }
    return byCat;
  }, [permissions, search]);

  const selected = useMemo(() => new Set(value), [value]);
  const toggle = (id: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(Array.from(next));
  };
  const setMany = (ids: string[], on: boolean) => {
    if (disabled) return;
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(Array.from(next));
  };

  const totalVisible = Array.from(grouped.values()).reduce(
    (acc, m) => acc + Array.from(m.values()).reduce((a, l) => a + l.length, 0),
    0,
  );
  const hasWildcard = permissions.some((p) => isWildcard(p.code) && selected.has(p.id));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Yetki kodu, açıklama veya modül ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="text-foreground font-medium">{value.length}</span> / {permissions.length} seçili
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange([])}
        >
          Temizle
        </Button>
      </div>

      {hasWildcard && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <span className="font-mono font-semibold">*</span> ile biten bir yetki seçili — bu yetki, ait olduğu kategorinin <span className="font-medium">tüm alt yetkilerini</span> kapsar.
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border">
        {totalVisible === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {emptyHint ?? "Eşleşen yetki bulunamadı."}
          </div>
        ) : (
          <div className="divide-y">
            {Array.from(grouped.entries()).map(([category, modules]) => {
              const allIds = Array.from(modules.values()).flat().map((p) => p.id);
              const allChecked = allIds.every((id) => selected.has(id));
              const someChecked = allIds.some((id) => selected.has(id));

              return (
                <section key={category}>
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-card/90 px-3 py-2 backdrop-blur">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={allChecked ? true : someChecked ? "indeterminate" : false}
                        onCheckedChange={(checked) => setMany(allIds, Boolean(checked))}
                        disabled={disabled}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {categoryLabels[category] ?? category}
                      </span>
                      <Badge variant="muted" className="font-normal">
                        {allIds.length}
                      </Badge>
                    </div>
                  </div>
                  {Array.from(modules.entries()).map(([module, perms]) => (
                    <ModuleRow
                      key={module}
                      module={module}
                      perms={perms}
                      selected={selected}
                      toggle={toggle}
                      setMany={setMany}
                      disabled={disabled}
                    />
                  ))}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface ModuleRowProps {
  module: string;
  perms: Permission[];
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  disabled?: boolean;
}

function ModuleRow({ module, perms, selected, toggle, setMany, disabled }: ModuleRowProps) {
  const ids = perms.map((p) => p.id);
  const allChecked = ids.every((id) => selected.has(id));
  const someChecked = ids.some((id) => selected.has(id));

  return (
    <div className="px-3 py-2">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={(checked) => setMany(ids, Boolean(checked))}
          disabled={disabled}
        />
        <span className="text-sm font-medium">{moduleLabels[module] ?? module}</span>
      </label>
      <ul className="ml-6 mt-1 grid gap-1 sm:grid-cols-2">
        {perms.map((p) => {
          const wild = isWildcard(p.code);
          const checked = selected.has(p.id);
          return (
            <li key={p.id}>
              <label
                className={cn(
                  "flex items-start gap-2 rounded-md p-1.5 hover:bg-accent/50",
                  wild && "border border-destructive/30 bg-destructive/5 hover:bg-destructive/10",
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={() => toggle(p.id)}
                  disabled={disabled}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("font-mono text-xs", wild && "text-destructive")}>{p.code}</span>
                    {wild && (
                      <Badge variant="destructive" className="text-[10px]" title="Bu yetki, kategorideki tüm alt yetkileri otomatik kapsar.">
                        tüm yetkiler
                      </Badge>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.description}</p>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
