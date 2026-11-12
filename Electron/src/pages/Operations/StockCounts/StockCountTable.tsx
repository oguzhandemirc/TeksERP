// Stok sayımları tablosu — ortak DataTable sütunları (düzen `stock-count:list` altında kullanıcıya kayıtlı).
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { formatFactory } from "@/lib/factory-time";
import type { StockCountListRow } from "./service";
import { STATUS_BADGE, STATUS_LABEL } from "./stockCountRules";

const stamp = (iso: string | null | undefined) => (iso ? formatFactory(iso, "dd MMM yyyy HH:mm") : "");

export const STOCK_COUNT_COLUMNS: ColumnDef<StockCountListRow>[] = [
  { accessorKey: "countNo", header: "Sayım No", cell: ({ row }) => <span className="font-mono text-xs">{row.original.countNo}</span> },
  { id: "createdAt", header: "Açılış", meta: { label: "Açılış", exportValue: (r) => stamp(r.createdAt) }, cell: ({ row }) => stamp(row.original.createdAt) },
  { id: "warehouse", header: "Depo", meta: { label: "Depo", exportValue: (r) => r.warehouse?.name ?? "" }, cell: ({ row }) => row.original.warehouse?.name ?? "—" },
  // Kırılım (top/iplik) DETAYDA — listede tek sayı yeterli ve iki birimi tek hücrede toplamak zaten yanlış olurdu.
  { id: "lines", header: "Satır", size: 80, meta: { label: "Satır", align: "right", exportValue: (r) => r._count.lines }, cell: ({ row }) => <span className="tabular-nums">{row.original._count.lines}</span> },
  {
    id: "status",
    header: "Durum",
    meta: { label: "Durum", exportValue: (r) => STATUS_LABEL[r.status] + (r.reversedAt ? " · Stornolandı" : "") },
    cell: ({ row: { original: r } }) => (
      <span>
        <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
        {r.reversedAt && (
          <Badge variant="outline" className="ml-1">
            Stornolandı
          </Badge>
        )}
      </span>
    ),
  },
  {
    id: "closedAt",
    header: "Kapanış",
    meta: { label: "Kapanış", exportValue: (r) => stamp(r.completedAt ?? r.cancelledAt) },
    cell: ({ row: { original: r } }) => <span className="text-xs text-muted-foreground">{stamp(r.completedAt ?? r.cancelledAt) || "—"}</span>,
  },
];
