// Emanet çıkış listesi tablosu — satır tıklaması detayı açar. Sayılar sunucudan (string), istemci toplamaz.
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatFactory } from "@/lib/factory-time";
import { fmtNum } from "./consignmentText";
import type { ConsignmentDispatchListRow } from "./types";

export const CONSIGNMENT_DISPATCH_COLUMNS: ColumnDef<ConsignmentDispatchListRow>[] = [
  { accessorKey: "dispatchNo", header: "Belge No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.dispatchNo}</span> },
  {
    id: "dispatchedAt",
    header: "Tarih",
    meta: { label: "Tarih", exportValue: (r) => formatFactory(r.dispatchedAt, "dd MMM yyyy HH:mm") },
    cell: ({ row }) => formatFactory(row.original.dispatchedAt, "dd MMM yyyy HH:mm"),
  },
  { id: "owner", header: "Müşteri", size: 220, meta: { label: "Müşteri", exportValue: (r) => r.ownerCustomer.name }, cell: ({ row }) => row.original.ownerCustomer.name },
  { accessorKey: "beamCount", header: "Levent", size: 90, meta: { align: "right" }, cell: ({ row }) => <span className="tabular-nums">{row.original.beamCount}</span> },
  { id: "beamLengthM", header: "Levent metre", meta: { label: "Levent metre", align: "right", exportValue: (r) => fmtNum(r.beamLengthM) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.beamLengthM)}</span> },
  { id: "yarnKg", header: "İplik kg", meta: { label: "İplik kg", align: "right", exportValue: (r) => fmtNum(r.yarnKg) }, cell: ({ row }) => <span className="tabular-nums">{fmtNum(row.original.yarnKg)}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => (r.cancelledAt ? "İptal" : "Geçerli") },
    cell: ({ row }) => (row.original.cancelledAt ? <Badge variant="outline">İptal</Badge> : <Badge>Geçerli</Badge>),
  },
];
