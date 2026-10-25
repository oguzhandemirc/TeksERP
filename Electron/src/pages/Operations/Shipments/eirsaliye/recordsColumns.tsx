import type { ColumnDef } from "@tanstack/react-table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { EIrsaliyeStatusBadge } from "./EIrsaliyeStatusBadge";
import type { EIrsaliyeListItem } from "./types";

export const eIrsaliyeRecordColumns: ColumnDef<EIrsaliyeListItem>[] = [
  {
    id: "documentNo",
    header: "e-İrsaliye No",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="font-mono text-xs font-semibold">{row.original.documentNo ?? "Numarasız taslak"}</div>
        {row.original.confirmedNo && row.original.confirmedNo !== row.original.documentNo && (
          <div className="font-mono text-[10px] text-muted-foreground">portal: {row.original.confirmedNo}</div>
        )}
      </div>
    ),
  },
  {
    id: "status",
    header: "Durum",
    cell: ({ row }) => <EIrsaliyeStatusBadge status={row.original.status} simulasyon={row.original.simulasyon} />,
  },
  {
    id: "shipment",
    header: "Sevkiyat",
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.shipment?.shipmentNo ?? "—"}</span>,
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => <span className="block max-w-[16rem] truncate">{row.original.shipment?.customer.name ?? "—"}</span>,
  },
  {
    id: "createdAt",
    header: "Hazırlandı",
    cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{fmtFactoryDateTime(row.original.createdAt)}</span>,
  },
  {
    id: "sentAt",
    header: "Gönderildi",
    cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{fmtFactoryDateTime(row.original.sentAt)}</span>,
  },
  {
    id: "responseAt",
    header: "Yanıt",
    cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{fmtFactoryDateTime(row.original.responseAt)}</span>,
  },
];
