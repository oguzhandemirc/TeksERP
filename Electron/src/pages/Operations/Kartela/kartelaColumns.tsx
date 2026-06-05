import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import type { KartelaDispatchListItem, KartelaReceiptListItem } from "./service";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

export const kartelaDispatchColumns: ColumnDef<KartelaDispatchListItem>[] = [
  {
    accessorKey: "dispatchNo",
    header: "Belge No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.dispatchNo}</span>,
  },
  {
    id: "subcontractor",
    header: "Firma",
    cell: ({ row }) => row.original.subcontractor.name,
  },
  {
    accessorKey: "dispatchedAt",
    header: "Tarih",
    cell: ({ row }) => (
      <span className="text-xs">{safeFormat(row.original.dispatchedAt, "dd.MM.yyyy HH:mm")}</span>
    ),
  },
  {
    id: "items",
    header: () => <div className="text-right">Top</div>,
    meta: { label: "Top" },
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original._count.items}</div>,
  },
  {
    accessorKey: "totalQty",
    header: () => <div className="text-right">Metre</div>,
    meta: { label: "Metre" },
    cell: ({ row }) => <div className="text-right tabular-nums">{DEC.format(row.original.totalQty)}</div>,
  },
  {
    id: "receipts",
    header: () => <div className="text-right">Kabul</div>,
    meta: { label: "Kabul" },
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original._count.receipts}</div>,
  },
  {
    id: "durum",
    header: "Durum",
    cell: ({ row }) =>
      row.original.cancelledAt ? (
        <Badge variant="destructive">İptal</Badge>
      ) : (
        <Badge variant="secondary">Aktif</Badge>
      ),
  },
];

export const kartelaReceiptColumns: ColumnDef<KartelaReceiptListItem>[] = [
  {
    accessorKey: "receiptNo",
    header: "Belge No",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.receiptNo}</span>,
  },
  {
    id: "subcontractor",
    header: "Firma",
    cell: ({ row }) => row.original.subcontractor.name,
  },
  {
    accessorKey: "receivedAt",
    header: "Tarih",
    cell: ({ row }) => (
      <span className="text-xs">{safeFormat(row.original.receivedAt, "dd.MM.yyyy HH:mm")}</span>
    ),
  },
  {
    accessorKey: "manifestNo",
    header: "İrsaliye",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{row.original.manifestNo ?? "—"}</span>
    ),
  },
  {
    id: "items",
    header: () => <div className="text-right">Top</div>,
    meta: { label: "Top" },
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original._count.items}</div>,
  },
  {
    id: "swatches",
    header: () => <div className="text-right">Kartela</div>,
    meta: { label: "Kartela" },
    cell: ({ row }) => <div className="text-right tabular-nums">{row.original._count.swatches}</div>,
  },
  {
    id: "durum",
    header: "Durum",
    cell: ({ row }) =>
      row.original.cancelledAt ? (
        <Badge variant="destructive">İptal</Badge>
      ) : (
        <Badge variant="secondary">Aktif</Badge>
      ),
  },
];
