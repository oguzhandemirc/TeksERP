import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WEAVING_KIND_LABEL, WEAVING_STATUS_META, formatDay, formatPlannedM, type WeavingOrder } from "./types";

/** Sıralama başlığı YOK: uç yalnız "en yeni önce" sıralar (sortBy göndermez). */
export const weavingOrderColumns: ColumnDef<WeavingOrder>[] = [
  {
    accessorKey: "weavingOrderNumber",
    header: "Dokuma No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.weavingOrderNumber}</span>,
  },
  {
    id: "item",
    header: "Kumaş",
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.item.name}</span>
        <span className="text-muted-foreground text-xs">
          <span className="font-mono">{row.original.item.code}</span>
          {row.original.color ? ` · ${row.original.color.name}` : " · renk yok (ham)"}
        </span>
      </span>
    ),
  },
  {
    id: "party",
    header: "Kim dokuyor",
    cell: ({ row }) => {
      const r = row.original;
      return (
        <span className="flex flex-col text-xs">
          <span>{WEAVING_KIND_LABEL[r.executionKind]}</span>
          {r.subcontractor && <span className="text-muted-foreground">{r.subcontractor.name}</span>}
        </span>
      );
    },
  },
  {
    id: "warpSpec",
    header: "Çözgü kartı",
    cell: ({ row }) =>
      row.original.warpSpec ? (
        <span className="text-xs">{row.original.warpSpec.name}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "plannedM",
    header: () => <span className="block text-right">Hedef</span>,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">{formatPlannedM(row.original.plannedM)}</span>
    ),
  },
  {
    id: "dates",
    header: "Plan",
    cell: ({ row }) => {
      const { plannedStartDate: s, plannedEndDate: e } = row.original;
      if (!s && !e) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {formatDay(s)} → {formatDay(e)}
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => {
      const r = row.original;
      const meta = WEAVING_STATUS_META[r.status];
      return (
        <span className="flex flex-col items-start gap-0.5">
          <Badge variant="outline" className={cn("border-transparent", meta.badgeClass)}>
            {meta.label}
          </Badge>
          {/* Açık koşum kapanışı ENGELLER — sayı görünür ki "kapat" neden reddedildi sorusu
              tıklamadan cevaplansın. */}
          {r.openRunCount > 0 && (
            <span className="text-[11px] text-muted-foreground">{r.openRunCount} açık koşum</span>
          )}
        </span>
      );
    },
  },
];
