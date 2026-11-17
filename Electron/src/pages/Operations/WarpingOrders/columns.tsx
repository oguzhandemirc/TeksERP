import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { dueText, fmtM } from "./order-model";
import { warpingStatusMeta, type WarpingOrderRow } from "./types";

/** Sıralama başlığı YOK: uç en yeni önce sıralar; süzme sunucuda. Dönen metre / deverecide kalan D7 (dönüş kabulü) ile gelir. */
export const warpingOrderColumns: ColumnDef<WarpingOrderRow>[] = [
  { accessorKey: "orderNo", header: "Sipariş No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.orderNo}</span> },
  {
    id: "warpSpec",
    header: "Çözgü kartı",
    meta: { exportValue: (r: WarpingOrderRow) => `${r.warpSpec.code} ${r.warpSpec.name}` },
    cell: ({ row }) => (
      <span className="flex flex-col">
        <span>{row.original.warpSpec.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{row.original.warpSpec.code}</span>
      </span>
    ),
  },
  { id: "subcontractor", header: "Devereci", meta: { exportValue: (r: WarpingOrderRow) => r.subcontractor.name }, cell: ({ row }) => row.original.subcontractor.name },
  {
    id: "target",
    header: "Hedef",
    meta: { exportValue: (r: WarpingOrderRow) => `${r.beamCount} levent · ${fmtM(r.targetLengthM)} m` },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.beamCount} levent · {fmtM(row.original.targetLengthM)} m
      </span>
    ),
  },
  {
    id: "status",
    header: "Durum",
    meta: { exportValue: (r: WarpingOrderRow) => warpingStatusMeta(r.status).label },
    cell: ({ row }) => {
      const m = warpingStatusMeta(row.original.status);
      return <Badge className={cn("font-normal", m.badgeClass)}>{m.label}</Badge>;
    },
  },
  {
    id: "due",
    header: "Termin",
    meta: { exportValue: (r: WarpingOrderRow) => dueText(r.expectedReturnAt, r.status).text },
    cell: ({ row }) => {
      const d = dueText(row.original.expectedReturnAt, row.original.status);
      return <span className={cn("tabular-nums", d.late && "font-medium text-destructive")}>{d.text}</span>;
    },
  },
  { id: "createdAt", header: "Açılış", meta: { exportValue: (r: WarpingOrderRow) => fmtFactoryDate(r.createdAt) }, cell: ({ row }) => <span className="tabular-nums">{fmtFactoryDate(row.original.createdAt)}</span> },
];
