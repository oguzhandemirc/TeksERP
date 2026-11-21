import type { ColumnDef } from "@tanstack/react-table";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import type { WarpingReceiveDocRow } from "@/pages/Operations/WarpingOrders/receive-doc-types";

const ordersText = (r: WarpingReceiveDocRow) => r.orders.map((o) => o.orderNo).join(", ");

/** Sıralama başlığı YOK: uç en yeni önce sıralar; süzme sunucuda. */
export const receiveDocColumns: ColumnDef<WarpingReceiveDocRow>[] = [
  { accessorKey: "docNo", header: "Belge No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.docNo}</span> },
  { id: "createdAt", header: "Kabul", meta: { exportValue: (r: WarpingReceiveDocRow) => fmtFactoryDateTime(r.createdAt) }, cell: ({ row }) => <span className="tabular-nums">{fmtFactoryDateTime(row.original.createdAt)}</span> },
  { id: "subcontractor", header: "Devereci", meta: { exportValue: (r: WarpingReceiveDocRow) => r.subcontractor.name }, cell: ({ row }) => row.original.subcontractor.name },
  {
    id: "deliveryNoteNo",
    header: "İrsaliye No",
    meta: { exportValue: (r: WarpingReceiveDocRow) => r.deliveryNoteNo ?? "" },
    cell: ({ row }) => (row.original.deliveryNoteNo ? <span className="font-mono text-xs">{row.original.deliveryNoteNo}</span> : <span className="text-muted-foreground">irsaliyesiz</span>),
  },
  { id: "orders", header: "Siparişler", meta: { exportValue: ordersText }, cell: ({ row }) => <span className="font-mono text-xs">{ordersText(row.original)}</span> },
  { id: "beamCount", header: "Levent", meta: { exportValue: (r: WarpingReceiveDocRow) => String(r.beamCount) }, cell: ({ row }) => <span className="tabular-nums">{row.original.beamCount}</span> },
];
