import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkOrder } from "./types";

/**
 * İş emrinin Tambur'da üretilen nihai topları — depo/A1/fire özeti + tek tek
 * liste (bölünmüş/iptal olanlar soluk). Hem slide-over hem tam sayfada kullanılır.
 */
export function ProducedRollsCard({ wo }: { wo: WorkOrder }) {
  const pr = wo.producedRolls;
  if (!pr || pr.count === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm font-medium tabular-nums">
          {pr.count} top
          <span className="mx-1 text-muted-foreground">·</span>
          {formatNumber(pr.totalMeters, 0)} m
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {pr.warehouse.count > 0 && (
            <Badge variant="muted" className="font-normal">
              Bitmiş Depo: {pr.warehouse.count} top · {formatNumber(pr.warehouse.totalMeters, 0)} m
            </Badge>
          )}
          {pr.a1.count > 0 && (
            <Badge variant="muted" className="font-normal">
              A1: {pr.a1.count} top · {formatNumber(pr.a1.totalMeters, 0)} m
            </Badge>
          )}
          {pr.fire.count > 0 && (
            <Badge variant="outline" className="font-normal text-destructive">
              Fire: {pr.fire.count} top · {formatNumber(pr.fire.totalMeters, 0)} m
            </Badge>
          )}
        </div>

        {pr.items.length > 0 && (
          <ul className="mt-2 max-h-72 divide-y overflow-auto rounded-md border bg-muted/30">
            {pr.items.map((r) => {
              const tone =
                r.qualityGrade === "FIRE"
                  ? "text-destructive"
                  : r.qualityGrade === "A1"
                    ? "text-warning"
                    : "text-foreground";
              const removed = r.status === "TAMBUR_CONSUMED" || r.status === "CANCELLED";
              const removedLabel =
                r.status === "TAMBUR_CONSUMED" ? "Bölündü" : r.status === "CANCELLED" ? "İptal" : null;
              return (
                <li
                  key={r.id}
                  className={cn(
                    "flex items-center justify-between gap-2 px-2 py-1 text-[11px]",
                    removed && "opacity-60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-mono">{r.barcode ?? "—"}</span>
                    <Badge variant="outline" className={`text-[9px] font-normal ${tone}`}>
                      {r.qualityGrade ?? "—"}
                    </Badge>
                    {removedLabel && (
                      <Badge variant="muted" className="text-[9px] font-normal">
                        {removedLabel}
                      </Badge>
                    )}
                    {r.color && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        {r.color.hex && (
                          <span
                            className="h-2 w-2 rounded-full border border-black/10"
                            style={{ backgroundColor: r.color.hex }}
                          />
                        )}
                        {r.color.name}
                      </span>
                    )}
                  </div>
                  <span className="font-medium tabular-nums">{formatNumber(r.currentQty, 0)} m</span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 text-[11px] text-muted-foreground">
          Metraj toplamı sağlam (depo + A1); fire metresi hariç.
        </div>
      </CardContent>
    </Card>
  );
}
