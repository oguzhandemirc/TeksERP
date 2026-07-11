import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { sackSearchService } from "./service";
import { sackDisplayState, sackStateLabels, type SackDisplayState, type SackSearchRow } from "./types";

const STATE_TONE: Record<SackDisplayState, string> = {
  OPEN: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  POOL: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  PLANNED: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  AT_DOOR: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  DISPATCHED: "bg-muted text-muted-foreground",
};

function fmtQty(n: number): string {
  return `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;
}

interface Props {
  sack: SackSearchRow;
  /** Verilirse satır başında çeki-listesi seçim kutusu görünür. */
  selected?: boolean;
  onToggleSelect?: (sackId: string) => void;
}

/** Tek arama sonucu — başlık satırı + genişletilince lazy içerik dökümü. */
export function SackResultCard({ sack, selected, onToggleSelect }: Props) {
  const [open, setOpen] = useState(false);

  const contents = useQuery({
    queryKey: ["sack-search-contents", sack.id],
    queryFn: () => sackSearchService.contents(sack.id),
    enabled: open,
    staleTime: 30_000,
  });

  const hasMatch = sack.matchRollCount !== null;
  const state = sackDisplayState(sack);
  const location = sack.shipment
    ? `${sack.shipment.shipmentNo} · ${sack.customer?.name ?? ""}`
    : `Havuz · ${sack.customer?.name ?? ""}${sack.branch ? ` / ${sack.branch.name}` : ""}`;

  return (
    <div className={cn("rounded-lg border bg-card", selected && "border-primary/60 bg-primary/5")}>
      <div className="flex w-full items-center gap-3 px-4 py-3">
        {onToggleSelect && (
          <Checkbox
            checked={!!selected}
            onCheckedChange={() => onToggleSelect(sack.id)}
            aria-label={`Çuval ${sack.manualCode ?? sack.seq} seç`}
          />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{sack.manualCode ?? sack.sackNo}</span>
              {sack.manualCode && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {sack.sackNo}
                </Badge>
              )}
              <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATE_TONE[state])}>
                {sackStateLabels[state]}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{location}</div>
          </div>
          <div className="shrink-0 text-right text-xs">
            {hasMatch && (
              <div className="font-medium text-primary">
                Eşleşen: {sack.matchRollCount} top · {fmtQty(sack.matchQty ?? 0)}
              </div>
            )}
            <div className="text-muted-foreground">
              {sack.rollCount} top · {fmtQty(sack.totalQty)}
              {sack.swatchCount > 0 ? ` · ${sack.swatchCount} kartela` : ""}
              {sack.weightKg !== null ? ` · ${sack.weightKg.toLocaleString("tr-TR", { useGrouping: false })} kg` : ""}
            </div>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </div>

      {open && (
        <div className="border-t px-4 py-3">
          {contents.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium">Barkod</th>
                  <th className="pb-1 font-medium">Ürün</th>
                  <th className="pb-1 font-medium">Renk</th>
                  <th className="pb-1 text-right font-medium">En</th>
                  <th className="pb-1 text-right font-medium">Metre</th>
                  <th className="pb-1 text-right font-medium">Kalite</th>
                </tr>
              </thead>
              <tbody>
                {(contents.data?.data.rolls ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-dashed">
                    <td className="py-1 font-mono">{r.barcode}</td>
                    <td className="py-1">{r.item.name}</td>
                    <td className="py-1">
                      <span className="inline-flex items-center gap-1.5">
                        {r.color?.hex && (
                          <span
                            className="h-2.5 w-2.5 rounded-full border"
                            style={{ backgroundColor: r.color.hex }}
                          />
                        )}
                        {r.color?.name ?? "Ham"}
                      </span>
                    </td>
                    <td className="py-1 text-right">{r.width ? `${r.width} cm` : "—"}</td>
                    <td className="py-1 text-right">{fmtQty(r.currentQty)}</td>
                    <td className="py-1 text-right">{r.qualityGrade}</td>
                  </tr>
                ))}
                {(contents.data?.data.swatches ?? []).map((s) => (
                  <tr key={s.id} className="border-t border-dashed text-muted-foreground">
                    <td className="py-1 font-mono">{s.barcode}</td>
                    <td className="py-1">{s.item.name} (kartela)</td>
                    <td className="py-1">{s.color?.name ?? "—"}</td>
                    <td className="py-1 text-right">—</td>
                    <td className="py-1 text-right">—</td>
                    <td className="py-1 text-right">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
