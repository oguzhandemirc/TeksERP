import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { durationLabel, weekdaysLabel, windowLabel, type ShiftDefinition } from "./types";

export function shiftColumns(actions: (row: ShiftDefinition) => ReactNode): ColumnDef<ShiftDefinition>[] {
  return [
    { id: "code", header: "Kod", cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span> },
    { id: "name", header: "Ad", cell: ({ row }) => row.original.name },
    { id: "window", header: "Saat", cell: ({ row }) => <span className="font-mono text-xs">{windowLabel(row.original)}</span> },
    { id: "duration", header: "Süre", cell: ({ row }) => durationLabel(row.original.durationMinutes) },
    { id: "break", header: "Mola", cell: ({ row }) => `${row.original.plannedBreakMinutes} dk` },
    { id: "days", header: "Günler", cell: ({ row }) => weekdaysLabel(row.original.activeWeekdays) },
    {
      id: "status",
      header: "Durum",
      cell: ({ row }) => (row.original.isActive ? <Badge>Aktif</Badge> : <Badge variant="outline">Arşivde</Badge>),
    },
    { id: "actions", header: "", cell: ({ row }) => actions(row.original) },
  ];
}
