import { StickyNote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { safeFormat, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StepStateBadge } from "./step-state";
import type { WorkOrderStepLite } from "./types";

/**
 * Tam sayfa detayında bir rota adımının "şu an" durumunu gösteren kart.
 * Slide-over'daki satır-içi adım render'ının ferah/grid versiyonu — birden
 * çok dal olunca her adım kendi kartında WIP'i + aktif fason sevkleriyle durur.
 */
export function StepWipCard({ step }: { step: WorkOrderStepLite }) {
  const wip = step.currentRolls;
  const hasWip = (wip?.count ?? 0) > 0;

  return (
    <Card className={cn(hasWip && "border-primary/40")}>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="muted"
            className="h-5 w-5 justify-center font-mono text-[10px]"
          >
            {step.stepSequence}
          </Badge>
          <span className="flex-1 text-sm font-medium">
            {step.station?.name ?? "—"}
          </span>
          <StepStateBadge step={step} />
        </div>

        {step.notes && step.notes.trim() && (
          <div className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <StickyNote className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />
            <span className="whitespace-pre-wrap italic">{step.notes}</span>
          </div>
        )}

        {hasWip ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-muted-foreground">Şu an:</span>
              <span className="font-medium tabular-nums">{wip!.count} parça</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium tabular-nums">
                {formatNumber(wip!.totalMeters, 0)} m
              </span>
              {wip!.rawCount > 0 && (
                <Badge variant="outline" className="font-normal">
                  Ham: {wip!.rawCount} · {formatNumber(wip!.rawMeters, 0)} m
                </Badge>
              )}
              {wip!.dyedCount > 0 && (
                <Badge variant="outline" className="font-normal">
                  Boyalı: {wip!.dyedCount} · {formatNumber(wip!.dyedMeters, 0)} m
                </Badge>
              )}
              {wip!.openFabricCount > 0 && (
                <Badge variant="outline" className="font-normal">
                  Açık kumaş: {wip!.openFabricCount} ·{" "}
                  {formatNumber(wip!.openFabricMeters, 0)} m
                </Badge>
              )}
            </div>
            {step.currentRollList && step.currentRollList.length > 0 && (
              <ul className="divide-y rounded-md border bg-muted/30">
                {step.currentRollList.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 px-2 py-1 text-[11px]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {r.barcode ? (
                        <span className="font-mono">{r.barcode}</span>
                      ) : (
                        <Badge variant="outline" className="text-[9px]">
                          Açık Kumaş
                        </Badge>
                      )}
                      {r.item && (
                        <span className="truncate font-medium">{r.item.name}</span>
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
                      {r.kind === "raw" && (
                        <Badge variant="outline" className="text-[9px] font-normal">
                          Ham
                        </Badge>
                      )}
                      {r.qualityGrade && r.qualityGrade !== "1.KALITE" && (
                        <Badge variant="outline" className="text-[9px] font-normal">
                          {r.qualityGrade}
                        </Badge>
                      )}
                    </div>
                    <span className="font-medium tabular-nums">
                      {formatNumber(r.currentQty, 0)} m
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            Şu an bu adımda mal yok.
          </div>
        )}

        {step.dispatches && step.dispatches.length > 0 && (
          <div className="space-y-1 rounded-md border border-dashed p-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Fason Sevkler ({step.dispatches.length})
            </div>
            {step.dispatches.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="font-mono">{d.dispatchNo}</span>
                  <span className="truncate text-muted-foreground">
                    → {d.subcontractor.name}
                  </span>
                  <span className="text-muted-foreground">
                    {safeFormat(d.dispatchedAt, "dd.MM.yyyy")}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatNumber(d.totalQty, 0)} m
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
