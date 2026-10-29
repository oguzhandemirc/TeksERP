import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { SOURCE_TONE_CLASS, stopSourceBadge } from "./source-badge";
import { LOSS_CLASS_META, formatDateTime, formatDuration, watchdogCloseNote, type MachineStop } from "./types";

interface Deps {
  labelOf: (code: string | null) => string;
  nowMs: number;
  actions: (row: MachineStop) => ReactNode;
  /** Makine sütun başlığı: "Tezgah" (dokuma) | "Makine" (dokumasız rejim). */
  noun?: string;
}

/** Süre + watchdog notu (D4): geçici kapanış tahmindir, satırda öyle söylenir. */
function DurationCell({ r, nowMs }: { r: MachineStop; nowMs: number }) {
  const wd = watchdogCloseNote(r);
  return (
    <span className="flex flex-col">
      <span className={cn("font-mono text-xs", !r.endedAt && "text-amber-700 dark:text-amber-300")}>
        {formatDuration(r.durationSec, r.startedAt, r.endedAt, nowMs)}
        {r.endedAt ? "" : " · sürüyor"}
      </span>
      {wd && (
        <span data-testid="watchdog-note" title={wd.hint} className={cn("text-xs", r.endCorrectedAt ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300")}>
          {wd.label}
        </span>
      )}
    </span>
  );
}

/** Kaynak rozeti: Kart / Elle / Simüle — simüle ayrı tonla, ipucunda SİMÜLASYON. */
function SourceCell({ r }: { r: MachineStop }) {
  const b = stopSourceBadge(r);
  return (
    <span className="flex flex-col items-start gap-0.5">
      <Badge data-testid="stop-source" title={b.hint} className={SOURCE_TONE_CLASS[b.tone]}>
        {b.label}
      </Badge>
      {b.notes.length > 0 && <span className="text-muted-foreground text-xs">{b.notes.join(" · ")}</span>}
    </span>
  );
}

/** Sıralama başlığı YOK: uç en yeni önce sıralar; süzme sunucuda. */
export function stopColumns({ labelOf, nowMs, actions, noun = "Tezgah" }: Deps): ColumnDef<MachineStop>[] {
  return [
    {
      id: "machine",
      header: noun,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span>{row.original.machine.name}</span>
          <span className="text-muted-foreground font-mono text-xs">{row.original.machine.code}</span>
        </span>
      ),
    },
    {
      id: "shift",
      header: "Vardiya",
      cell: ({ row }) => {
        const s = row.original.shiftInstance;
        if (!s) return <span className="text-muted-foreground text-xs">vardiya yok</span>;
        return (
          <span className={cn("text-xs", s.isCancelled && "line-through")}>
            {s.shiftDefinition.name}
            {s.isCancelled ? " (iptal)" : ""}
          </span>
        );
      },
    },
    { id: "start", header: "Başlangıç", cell: ({ row }) => <span className="font-mono text-xs">{formatDateTime(row.original.startedAt)}</span> },
    {
      id: "duration",
      header: "Süre",
      cell: ({ row }) => <DurationCell r={row.original} nowMs={nowMs} />,
    },
    {
      id: "reason",
      header: "Sebep",
      cell: ({ row }) => {
        const r = row.original;
        if (!r.reasonCode) {
          return <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{r.requiresReason ? "Sebep bekliyor" : "—"}</Badge>;
        }
        return (
          <span className="flex flex-col">
            <span>{labelOf(r.reasonCode)}</span>
            {r.reasonNote && <span className="text-muted-foreground text-xs">{r.reasonNote}</span>}
            {r.classifiedBy && (
              <span className="text-muted-foreground text-xs">
                {r.classifiedBy.fullName} · {formatDateTime(r.classifiedAt)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "lossClass",
      header: "Kayıp sınıfı",
      cell: ({ row }) => {
        const lc = row.original.lossClass;
        return lc ? <Badge className={LOSS_CLASS_META[lc].badgeClass}>{LOSS_CLASS_META[lc].label}</Badge> : <span className="text-muted-foreground">—</span>;
      },
    },
    { id: "source", header: "Kaynak", cell: ({ row }) => <SourceCell r={row.original} /> },
    { id: "actions", header: "", cell: ({ row }) => actions(row.original) },
  ];
}
