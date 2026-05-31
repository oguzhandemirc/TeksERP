import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Cog, Disc3, Package, Send, Undo2, Warehouse, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Stagger, StaggerItem } from "@/components/motion";
import { cn } from "@/lib/utils";
import { rollService } from "./service";
import { RollDetailSheet } from "./RollDetailSheet";
import type { Roll } from "./types";

// Üretim akışı kolonları — status → kolon. Salt-okunur görselleştirme; gerçek
// geçişler fiziksel traveler-card okutmayla olur (sürükleme yok).
interface ColumnDef {
  status: string;
  label: string;
  icon: LucideIcon;
  dot: string;
  bar: string;
}
const COLUMNS: ColumnDef[] = [
  { status: "STOCK", label: "Ham Stok", icon: Package, dot: "bg-station-kk1", bar: "bg-station-kk1" },
  { status: "AT_SUBCONTRACTOR", label: "Fason'da", icon: Send, dot: "bg-station-fason", bar: "bg-station-fason" },
  { status: "RETURNED_FROM_SUBCONTRACTOR", label: "Fason Dönüşü", icon: Undo2, dot: "bg-station-fason", bar: "bg-station-fason" },
  { status: "IN_PRODUCTION", label: "Üretimde", icon: Cog, dot: "bg-station-process", bar: "bg-station-process" },
  { status: "PRODUCED", label: "Üretildi", icon: Disc3, dot: "bg-station-tambur", bar: "bg-station-tambur" },
  { status: "WAREHOUSE", label: "Depo", icon: Warehouse, dot: "bg-station-depo", bar: "bg-station-depo" },
];
const PREVIEW_LIMIT = 12;

export function RollsKanban() {
  const [selected, setSelected] = useState<Roll | null>(null);

  const results = useQueries({
    queries: COLUMNS.map((c) => ({
      queryKey: ["rolls", "kanban", c.status],
      queryFn: () =>
        rollService.listCursor({
          cursor: null,
          limit: PREVIEW_LIMIT,
          sortBy: "createdAt",
          sortOrder: "desc" as const,
          withTotal: true,
          filters: { status: c.status },
        }),
      staleTime: 30_000,
    })),
  });

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="flex gap-3">
        {COLUMNS.map((col, i) => {
          const r = results[i]!;
          const rolls = r.data?.data ?? [];
          const total = r.data?.pagination.totalEstimate ?? rolls.length;
          const more = Math.max(0, total - rolls.length);
          return (
            <div key={col.status} className="flex w-64 shrink-0 flex-col rounded-lg border bg-card/40">
              <div className={cn("h-1 rounded-t-lg", col.bar)} />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <col.icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">{col.label}</span>
                <span className="ml-auto rounded bg-muted px-1.5 text-[10px] font-medium tabular-nums">
                  {r.isLoading ? "…" : total}
                </span>
              </div>
              <div className="flex flex-col gap-2 px-2 pb-2">
                {r.isLoading ? (
                  Array.from({ length: 3 }).map((_, k) => <Skeleton key={k} className="h-16 w-full" />)
                ) : rolls.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-muted-foreground">Boş</p>
                ) : (
                  <Stagger className="flex flex-col gap-2">
                    {rolls.map((roll) => (
                      <StaggerItem key={roll.id}>
                        <KanbanCard roll={roll} onClick={() => setSelected(roll)} />
                      </StaggerItem>
                    ))}
                    {more > 0 && (
                      <p className="px-1 pt-1 text-center text-[11px] text-muted-foreground">
                        +{more} daha
                      </p>
                    )}
                  </Stagger>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <RollDetailSheet
        roll={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function gradeClass(grade: string): string {
  if (grade === "FIRE") return "bg-destructive/15 text-destructive";
  if (grade === "A1") return "bg-warning/15 text-warning";
  return "bg-muted text-muted-foreground";
}

function KanbanCard({ roll, onClick }: { roll: Roll; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-glow w-full rounded-md border bg-card p-2.5 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs font-medium">
          {roll.barcode ?? "açık kumaş"}
        </span>
        {roll.color?.hex && (
          <span
            className="h-3 w-3 shrink-0 rounded-full border"
            style={{ background: roll.color.hex }}
            title={roll.color.name}
          />
        )}
      </div>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {roll.item ? `${roll.item.code} · ${roll.item.name}` : "—"}
      </p>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-xs font-medium tabular-nums">
          {roll.currentQty.toLocaleString("tr-TR")} m
        </span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", gradeClass(roll.qualityGrade))}>
          {roll.qualityGrade}
        </span>
      </div>
    </button>
  );
}
