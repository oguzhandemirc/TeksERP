// Sistem kayıtları (AUTH + SYSTEM) — ortak DataTable sütunları; satır ayrıntı çekmecesini açar.
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { formatFactory } from "@/lib/factory-time";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalTable } from "@/hooks/useLocalTable";
import { categoryLabels, categoryVariants, eventActionLabel, eventActionVariant } from "./labels";
import type { SystemLogListItem } from "@/types/systemLog";

const fullDate = (e: SystemLogListItem) => formatFactory(new Date(e.createdAt), "dd.MM.yyyy HH:mm:ss");
const userLabel = (e: SystemLogListItem) => (e.user ? e.user.fullName || e.user.username : "-");
const targetLabel = (e: SystemLogListItem) => (e.recordId === "-" ? "" : e.recordId);

const EVENT_COLUMNS: ColumnDef<SystemLogListItem>[] = [
  {
    id: "createdAt",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: fullDate },
    cell: ({ row: { original: e } }) => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs">{formatDistanceToNow(new Date(e.createdAt), { addSuffix: true, locale: tr })}</span>
        </TooltipTrigger>
        <TooltipContent side="right">{fullDate(e)}</TooltipContent>
      </Tooltip>
    ),
  },
  {
    id: "category",
    header: "Kategori",
    meta: { label: "Kategori", exportValue: (e) => categoryLabels[e.category] },
    cell: ({ row: { original: e } }) => <Badge variant={categoryVariants[e.category]} className="shrink-0">{categoryLabels[e.category]}</Badge>,
  },
  {
    id: "action",
    header: "Olay",
    meta: { label: "Olay", exportValue: (e) => eventActionLabel(e.action) },
    cell: ({ row: { original: e } }) => <Badge variant={eventActionVariant(e.action)} className="shrink-0">{eventActionLabel(e.action)}</Badge>,
  },
  {
    id: "recordId",
    header: "Hedef",
    meta: { label: "Hedef", exportValue: targetLabel },
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{targetLabel(row.original)}</span>,
  },
  { id: "user", header: "Kullanıcı", meta: { label: "Kullanıcı", exportValue: userLabel }, cell: ({ row }) => <span className="text-xs">{userLabel(row.original)}</span> },
  {
    id: "ipAddress",
    header: "IP",
    meta: { label: "IP", exportValue: (e) => e.ipAddress ?? "" },
    cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.ipAddress ?? ""}</span>,
  },
];

export function useSystemEventsTable(items: SystemLogListItem[]) {
  const columns = useMemo(() => EVENT_COLUMNS, []);
  return useLocalTable({ tableKey: "system:events", data: items, columns });
}
