// Kabul diyaloğunda tek top satırı: adet + (ölçüm açıksa) varsayılan cm/kg + "Tek tek" istisna satırları.
// Tablet ölçü penceresiyle aynı model: varsayılan hepsine uygulanır, yalnız farklı olan kartela değiştirilir.
import { ChevronDown, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { differingIndexes, parseCount, type ReceiveEntry } from "./kartelaActions";
import type { KartelaOutstandingItem } from "./service";

interface Props {
  item: KartelaOutstandingItem;
  entry: ReceiveEntry;
  onChange: (next: ReceiveEntry) => void;
  showMeasure: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  disabled: boolean;
}

const fmtM = (n: number) => Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1, useGrouping: false });
const decimalOnly = (v: string) => v.replace(/[^0-9.,]/g, "");

export function ReceiveRollRow({ item, entry, onChange, showMeasure, expanded, onToggleExpand, disabled }: Props) {
  const n = parseCount(entry.count);
  const diff = differingIndexes(entry).length;
  const set = (patch: Partial<ReceiveEntry>) => onChange({ ...entry, ...patch });
  const r = item.roll;
  return (
    <>
      <TableRow data-state={n > 0 ? "selected" : undefined}>
        <TableCell className="font-mono text-xs">{r.barcode ?? "—"}</TableCell>
        <TableCell className="max-w-[16rem] truncate">{r.item.name}{r.color ? ` · ${r.color.name}` : ""}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtM(item.dispatchedQty)}</TableCell>
        <TableCell>
          <Input aria-label={`${r.barcode ?? r.item.name} kartela adedi`} className="h-8 w-20 text-right" inputMode="numeric"
            value={entry.count} disabled={disabled} placeholder="0" onChange={(e) => set({ count: e.target.value.replace(/[^0-9]/g, "") })} />
        </TableCell>
        {showMeasure && (
          <>
            <TableCell>
              <Input aria-label={`${r.barcode ?? r.item.name} uzunluk cm`} className="h-8 w-20 text-right" inputMode="decimal"
                value={entry.defCm} disabled={disabled} placeholder="cm" onChange={(e) => set({ defCm: decimalOnly(e.target.value) })} />
            </TableCell>
            <TableCell>
              <Input aria-label={`${r.barcode ?? r.item.name} ağırlık kg`} className="h-8 w-20 text-right" inputMode="decimal"
                value={entry.defKg} disabled={disabled} placeholder="kg" onChange={(e) => set({ defKg: decimalOnly(e.target.value) })} />
            </TableCell>
            <TableCell>
              <button type="button" disabled={disabled || n === 0} onClick={onToggleExpand}
                className="flex items-center gap-1 text-xs text-primary disabled:text-muted-foreground">
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Tek tek{diff > 0 ? ` (${diff} farklı)` : ""}
              </button>
            </TableCell>
          </>
        )}
      </TableRow>
      {showMeasure && expanded && n > 0 && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7}>
            <ExceptionGrid entry={entry} count={n} onChange={onChange} disabled={disabled} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** Kartela başına ölçü — alan varsayılanla dolu görünür; silmek varsayılana döndürür. */
function ExceptionGrid({ entry, count, onChange, disabled }: { entry: ReceiveEntry; count: number; onChange: (e: ReceiveEntry) => void; disabled: boolean }) {
  const differs = new Set(differingIndexes(entry));
  const setEx = (i: number, key: "cm" | "kg", raw: string) => {
    const v = decimalOnly(raw);
    const cur = { ...entry.exceptions[i] };
    if (v.trim() === "") delete cur[key];
    else cur[key] = v;
    const next = { ...entry.exceptions };
    if (cur.cm == null && cur.kg == null) delete next[i];
    else next[i] = cur;
    onChange({ ...entry, exceptions: next });
  };
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1.5">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`flex items-center gap-1.5 rounded border px-2 py-1 ${differs.has(i) ? "border-primary/60 bg-primary/5" : ""}`}>
            <span className="w-8 text-xs text-muted-foreground">#{i + 1}</span>
            <Input aria-label={`Kartela ${i + 1} cm`} className="h-7 w-16 text-right text-xs" disabled={disabled}
              value={entry.exceptions[i]?.cm ?? entry.defCm} placeholder="cm" onChange={(e) => setEx(i, "cm", e.target.value)} />
            <Input aria-label={`Kartela ${i + 1} kg`} className="h-7 w-16 text-right text-xs" disabled={disabled}
              value={entry.exceptions[i]?.kg ?? entry.defKg} placeholder="kg" onChange={(e) => setEx(i, "kg", e.target.value)} />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Satırlar varsayılan ölçüyle dolu — yalnız farklı olanı değiştirin. Ölçüler isteğe bağlıdır.</p>
    </div>
  );
}
