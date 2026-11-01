// Gelen belge listesi sütunları (DataTable). Sıralama SUNUCUDA sabit (kayıt anı, yeni üstte) — başlıklar sıralamaz.
import type { ColumnDef } from "@tanstack/react-table";
import { formatFactory } from "@/lib/factory-time";
import { Badge } from "@/components/ui/badge";
import { NOTE_STATUS_LABEL, NOTE_STATUS_VARIANT, SOURCE_LABEL } from "./noteStatus";
import type { DeliveryNoteHeader } from "./types";

export const NOTE_COLUMNS: ColumnDef<DeliveryNoteHeader>[] = [
  { id: "noteNo", header: "No", accessorKey: "noteNo", cell: ({ row }) => <span className="whitespace-nowrap font-mono text-xs">{row.original.noteNo}</span> },
  {
    id: "createdAt",
    header: "Kayıt",
    accessorFn: (r) => formatFactory(r.createdAt, "dd MMM yyyy HH:mm"),
    cell: ({ getValue }) => <span className="whitespace-nowrap">{String(getValue())}</span>,
  },
  {
    id: "owner",
    header: "Sahip",
    accessorFn: (r) => r.ownerCustomer?.name ?? "",
    cell: ({ row }) => row.original.ownerCustomer?.name ?? <span className="text-amber-700 dark:text-amber-400">Sahip seçilmedi</span>,
  },
  { id: "sender", header: "Gönderen", accessorFn: (r) => r.senderCustomer?.name ?? r.senderText ?? "—" },
  { id: "senderDocNo", header: "Belge No", accessorFn: (r) => r.senderDocNo ?? "—", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{String(getValue())}</span> },
  { id: "lines", header: "Satır", accessorFn: (r) => r._count.lines, cell: ({ getValue }) => <span className="tabular-nums">{String(getValue())}</span> },
  { id: "sourceKind", header: "Kaynak", accessorFn: (r) => SOURCE_LABEL[r.sourceKind], cell: ({ getValue }) => <span className="text-xs">{String(getValue())}</span> },
  {
    id: "status",
    header: "Durum",
    accessorFn: (r) => NOTE_STATUS_LABEL[r.status],
    cell: ({ row }) => <Badge variant={NOTE_STATUS_VARIANT[row.original.status]}>{NOTE_STATUS_LABEL[row.original.status]}</Badge>,
  },
];
