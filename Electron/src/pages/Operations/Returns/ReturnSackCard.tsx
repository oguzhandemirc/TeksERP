import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { SackReturnLookupResult } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

interface Props {
  result: SackReturnLookupResult;
  /** Seçili top id'leri — iade YALNIZ bunlara uygulanır. */
  selected: Set<string>;
  onToggle: (rollId: string) => void;
  onToggleAll: (checked: boolean) => void;
}

/**
 * Çuval bazlı iade girişinde çuvalın kimlik kartı + iade alınabilir topların
 * seçim listesi.
 *
 * Varsayılan TÜMÜ SEÇİLİ: operatör çuvalı komple geri alıyorsa (yaygın durum) tek
 * dokunuşla biter; kısmi iadede seçim kaldırılır. Ters varsayılan (hiçbiri seçili
 * değil) yaygın durumu 20 tıka çıkarırdı.
 */
export function ReturnSackCard({ result, selected, onToggle, onToggleAll }: Props) {
  const allChecked = result.rolls.length > 0 && selected.size === result.rolls.length;
  const selectedQty = result.rolls
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + Number(r.currentQty || 0), 0);

  return (
    <div className="space-y-2 rounded-md border bg-card/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">{result.sack.sackNo}</span>
        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
          {selected.size}/{result.rolls.length} top · {DEC.format(selectedQty)} m
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {result.customer?.name ?? "—"}
        {result.branch ? ` · ${result.branch.name}` : ""}
        {` · ${result.shipment.shipmentNo}`}
      </div>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="text-xs font-medium text-muted-foreground">İade alınacak toplar</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => onToggleAll(!allChecked)}
        >
          {allChecked ? "Hiçbirini seçme" : "Tümünü seç"}
        </Button>
      </div>

      <ul className="max-h-56 divide-y overflow-y-auto rounded border">
        {result.rolls.map((r) => (
          <li key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <Checkbox
              checked={selected.has(r.id)}
              onCheckedChange={() => onToggle(r.id)}
              aria-label={`${r.barcode ?? r.id} seç`}
            />
            <span className="w-32 shrink-0 font-mono">{r.barcode ?? r.id.slice(0, 8)}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {r.item?.name ?? "—"}
              {r.color ? ` · ${r.color.name}` : ""}
              {r.width != null ? ` · ${r.width} cm` : ""}
              {r.qualityGrade ? ` · ${r.qualityGrade}` : ""}
            </span>
            <span className="shrink-0 tabular-nums">{DEC.format(Number(r.currentQty))} m</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
