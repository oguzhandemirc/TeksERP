import { Checkbox } from "@/components/ui/checkbox";
import type { PickedRoll } from "./pickable-rolls";

interface Props {
  rolls: PickedRoll[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  loading: boolean;
  emptyText: string;
}

/** İşaretlenebilir top satırları — seçicilerin ortak listesi (kumaş · renk · barkod · metraj). */
export function RollChecklist({ rolls, selected, onToggle, loading, emptyText }: Props) {
  return (
    <div className="max-h-[42vh] overflow-auto rounded-md border">
      {loading ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Yükleniyor…</p>
      ) : rolls.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        rolls.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/50">
            <Checkbox checked={selected.has(r.id)} onCheckedChange={() => onToggle(r.id)} />
            <span className="min-w-0 flex-1 truncate">
              {r.itemName}
              {r.colorName ? ` · ${r.colorName}` : ""}
            </span>
            {/* Barkodsuz top MEŞRU — etiket basmayan kullanıcıda olağan. */}
            <span className="font-mono text-xs text-muted-foreground">{r.barcode ?? "—"}</span>
            <span className="w-20 text-right tabular-nums">{r.qty} m</span>
          </label>
        ))
      )}
    </div>
  );
}

export function toggleInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
