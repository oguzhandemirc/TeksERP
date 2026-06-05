import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, workOrderStatusTones } from "@/components/operations/StatusBadge";
import { DeadlineBadge } from "@/components/operations/DeadlineBadge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { workOrderStatusLabels, workOrderTypeLabels } from "@/types/enums";
import { safeFormat } from "@/lib/format";
import type { WorkOrder } from "./types";

function progressOf(wo: WorkOrder): { done: number; total: number; pct: number } {
  const total = wo.steps?.length ?? 0;
  const done =
    wo.steps?.filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED").length ?? 0;
  return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export const workOrderColumns: ColumnDef<WorkOrder>[] = [
  {
    accessorKey: "batchNumber",
    header: "Parti Kodu",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.batchNumber}</span>,
  },
  {
    accessorKey: "type",
    header: "Tip",
    cell: ({ row }) => (
      <Badge variant="muted" className="text-[10px]">
        {workOrderTypeLabels[row.original.type] ?? row.original.type}
      </Badge>
    ),
  },
  {
    id: "progress",
    header: "İlerleme",
    cell: ({ row }) => {
      const p = progressOf(row.original);
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/60 transition-all" style={{ width: `${p.pct}%` }} />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {p.done}/{p.total}
          </span>
        </div>
      );
    },
  },
  {
    accessorKey: "targetQuantity",
    header: () => <SortableHeader field="targetQuantity" label="Hedef" />,
    meta: { label: "Hedef" },
    cell: ({ row }) =>
      row.original.targetQuantity != null ? (
        <span className="tabular-nums text-xs">
          {row.original.targetQuantity.toLocaleString("tr-TR")} m
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "plannedEndDate",
    header: () => <SortableHeader field="plannedEndDate" label="Termin" />,
    meta: { label: "Termin" },
    cell: ({ row }) => <DeadlineBadge deadline={row.original.plannedEndDate} />,
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Oluşturma" />,
    meta: { label: "Oluşturma" },
    cell: ({ row }) => <span className="text-xs">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>,
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.status}
        labels={workOrderStatusLabels}
        tones={workOrderStatusTones}
      />
    ),
  },
];
