// Süreç türü onay listesi — liste hücresinin modalı (ServiceProcessesDialog) ve Yeni/Düzenle formu (B16) aynı bileşeni
// kullanır. Başka karta eşli tür seçilemez (sunucu da 409 `SERVICE_PROCESS_TAKEN` der); pasif karta yalnız çıkarma.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { loadAllForPicker } from "@/lib/picker-loader";
import { cn } from "@/lib/utils";
import { subcontractorCategoryService } from "@/pages/SubcontractorCategories/service";
import { SERVICE_PROCESS_MAP_QUERY_KEY, getServiceProcessMap, processOptions, processesOf, type ProcessOption } from "./serviceProcesses";

/** Kartın (yeni kartta null) seçim durumu: harita + türler + seçili küme; ilk değer haritadan bir kez kurulur. */
export function useServiceProcessSelection(itemId: string | null, enabled: boolean) {
  const mapQ = useQuery({ queryKey: SERVICE_PROCESS_MAP_QUERY_KEY, queryFn: getServiceProcessMap, enabled });
  // Pasif türler de çekilir: bu karta eşli pasif tür listede kalmalı (çıkarılabilsin).
  const catQ = useQuery({
    queryKey: ["subcontractor-categories", "picker", "all"],
    queryFn: () => loadAllForPicker(subcontractorCategoryService, { filters: {} }),
    enabled,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<string[]>([]);
  const mapKey = (mapQ.data ?? []).map((r) => `${r.categoryId}:${r.serviceItemId}`).join(",");
  useEffect(() => {
    if (!mapQ.data) return;
    const own = itemId ? processesOf(itemId, mapQ.data).map((r) => r.categoryId) : [];
    setSelected(new Set(own));
    setInitial(own);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, mapKey]);
  const options = useMemo(() => processOptions(itemId ?? "", catQ.data?.data ?? [], mapQ.data ?? []), [itemId, catQ.data, mapQ.data]);
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const ids = [...selected];
  const changed = ids.length !== initial.length || ids.some((id) => !initial.includes(id));
  return { options, selected, toggle, ids, changed, loading: mapQ.isLoading || catQ.isLoading };
}

interface PickerProps {
  options: ProcessOption[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  loading: boolean;
  cardActive: boolean;
  className?: string;
}

export function ServiceProcessPicker({ options, selected, onToggle, loading, cardActive, className }: PickerProps) {
  return (
    <div className={cn("max-h-80 space-y-1 overflow-auto", className)} role="group" aria-label="Süreç türleri">
      {loading ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">Yükleniyor…</p>
      ) : options.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted-foreground">Süreç türü yok. Tanımlar › Fason Kategorileri ekranından ekleyin.</p>
      ) : (
        options.map((o) => <OptionRow key={o.id} option={o} on={selected.has(o.id)} cardActive={cardActive} onToggle={onToggle} />)
      )}
    </div>
  );
}

function OptionRow({ option: o, on, cardActive, onToggle }: { option: ProcessOption; on: boolean; cardActive: boolean; onToggle: (id: string, on: boolean) => void }) {
  // Başka karta eşli tür seçilemez; pasif karta yalnız çıkarma yapılır.
  const blocked = o.takenBy !== null || (!on && !cardActive);
  return (
    <label className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm", blocked ? "opacity-60" : "cursor-pointer hover:bg-muted/50", on && "border-primary bg-primary/5")}>
      <Checkbox checked={on} disabled={blocked} onCheckedChange={(v) => onToggle(o.id, Boolean(v))} aria-label={o.name} />
      <span className="min-w-0 flex-1 truncate">{o.name}</span>
      {o.inactive && <Badge variant="muted">Pasif</Badge>}
      {o.takenBy && <span className="truncate text-xs text-muted-foreground">{o.takenBy} kartına eşli</span>}
    </label>
  );
}
