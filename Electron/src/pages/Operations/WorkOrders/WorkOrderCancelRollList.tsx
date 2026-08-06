import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import {
  CANCEL_OPTIONS,
  groupByStation,
  isOptionDisabled,
  type CancelChoices,
} from "./cancelDecisions";
import type { CancelDisposition, CancelImpactRoll } from "./service";

interface Props {
  rolls: CancelImpactRoll[];
  choices: CancelChoices;
  onChange: (rollId: string, action: CancelDisposition) => void;
  onBulk: (action: CancelDisposition) => void;
  disabled?: boolean;
}

/**
 * İptalde karar listesi — istasyona göre gruplu, üstte toplu uygulama.
 *
 * Varsayılan HER TOPTA "Ham stok"tur; kullanıcı yalnız istisnayı işaretler. En sık
 * senaryo (hepsi geri dönsün) böylece hiç dokunmadan biter.
 */
export function WorkOrderCancelRollList({ rolls, choices, onChange, onBulk, disabled }: Props) {
  const decidable = useMemo(() => rolls.filter((r) => r.decidable), [rolls]);
  const groups = useMemo(() => groupByStation(decidable), [decidable]);

  if (decidable.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground">
        İstasyonda karar bekleyen top yok.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium">Toplar ({decidable.length})</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Hepsine:</span>
          {CANCEL_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => onBulk(o.value)}
              className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
        {groups.map((g) => (
          <div key={g.stationName} className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {g.stationName} ({g.rolls.length})
            </div>
            {g.rolls.map((r) => {
              const action = choices[r.id] ?? "STOCK";
              return (
                <div
                  key={r.id}
                  data-testid={`cancel-dispo-${r.id}`}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                    {r.colorName && (
                      <Badge variant="muted" className="gap-1 text-[10px]">
                        {r.colorHex && (
                          <span
                            className="h-2 w-2 rounded-full border"
                            style={{ backgroundColor: r.colorHex }}
                          />
                        )}
                        {r.colorName}
                      </Badge>
                    )}
                    <span className="tabular-nums text-muted-foreground">
                      {formatNumber(r.currentQty)} m
                    </span>
                  </span>
                  <Select
                    value={action}
                    disabled={disabled}
                    onValueChange={(v) => onChange(r.id, v as CancelDisposition)}
                  >
                    <SelectTrigger className="h-7 w-36 shrink-0 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CANCEL_OPTIONS.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={o.value}
                          disabled={isOptionDisabled(r, o.value)}
                          className="text-xs"
                        >
                          {o.label}
                          {isOptionDisabled(r, o.value) && " — fason dönüşü"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
