import type { ColumnDef } from "@tanstack/react-table";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { isWarehouseSack, type SackSearchRow } from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/** LOUD durum rozeti — Depoda (emerald) / Sevkte (violet=planlı) / Sevk Edildi (zinc). */
function statusBadge(sack: SackSearchRow): { label: string; className: string } {
  if (isWarehouseSack(sack)) return { label: "Depoda", className: "bg-emerald-600 text-white" };
  switch (sack.shipment!.status) {
    case "DISPATCHED":
      return { label: "Sevk Edildi", className: "bg-zinc-600 text-white" };
    default:
      return { label: "Sevkte", className: "bg-violet-600 text-white" };
  }
}

/**
 * Çuval listesi sütunları — Siparişler/Sevkiyatlar paritesinde satır-sütunlu tablo.
 * Yalnız `sackNo` ve `createdAt` sıralanabilir (SortableHeader); diğer başlıklar düz.
 * Her sütun `meta.label` taşır (göster/gizle menüsü + CSV başlığı).
 */
export const sacksColumns: ColumnDef<SackSearchRow>[] = [
  {
    id: "status",
    header: "Durum",
    meta: {
      label: "Durum",
      exportValue: (s) =>
        `${statusBadge(s).label}${s.shipment ? ` (${s.shipment.shipmentNo})` : ""}`,
    },
    cell: ({ row }) => {
      const s = row.original;
      const b = statusBadge(s);
      return (
        <div className="flex flex-col items-start gap-0.5">
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              b.className,
            )}
          >
            {b.label}
          </span>
          {s.shipment && (
            <span className="font-mono text-[10px] text-muted-foreground">{s.shipment.shipmentNo}</span>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "sackNo",
    header: () => <SortableHeader field="sackNo" label="Çuval No" />,
    meta: { label: "Çuval No" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sackNo}</span>,
  },
  {
    id: "customer",
    header: "Müşteri",
    meta: { label: "Müşteri" },
    cell: ({ row }) =>
      row.original.customer?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "branch",
    header: "Şube",
    meta: { label: "Şube" },
    cell: ({ row }) =>
      row.original.branch?.name ?? <span className="text-muted-foreground">—</span>,
  },
  {
    id: "match",
    header: "Eşleşen",
    meta: {
      label: "Eşleşen",
      exportValue: (s) =>
        s.matchRollCount === null ? "" : `${s.matchRollCount} top · ${fmtQty(s.matchQty ?? 0)}`,
    },
    cell: ({ row }) => {
      const s = row.original;
      if (s.matchRollCount === null) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="inline-flex whitespace-nowrap rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium tabular-nums text-primary">
          {s.matchRollCount} top · {fmtQty(s.matchQty ?? 0)}
        </span>
      );
    },
  },
  {
    id: "rolls",
    header: "Top",
    meta: { label: "Top", exportValue: (s) => `${s.rollCount}${s.swatchCount > 0 ? ` +${s.swatchCount} kartela` : ""}` },
    cell: ({ row }) => {
      const s = row.original;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          <span className="font-medium">{s.rollCount}</span>
          {s.swatchCount > 0 && (
            <span className="ml-1 text-muted-foreground">+{s.swatchCount} kartela</span>
          )}
        </span>
      );
    },
  },
  {
    id: "totalQty",
    header: "Metraj",
    meta: { label: "Metraj" },
    cell: ({ row }) => (
      <span className="tabular-nums text-xs">{fmtQty(row.original.totalQty)}</span>
    ),
  },
  {
    id: "weightKg",
    header: "Kg",
    meta: { label: "Kg" },
    cell: ({ row }) => {
      const kg = row.original.weightKg;
      return kg === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums text-xs">
          {kg.toLocaleString("tr-TR", { useGrouping: false })}
        </span>
      );
    },
  },
  {
    accessorKey: "createdAt",
    header: () => <SortableHeader field="createdAt" label="Tarih" />,
    meta: { label: "Tarih" },
    cell: ({ row }) => (
      <span className="tabular-nums text-xs">{safeFormat(row.original.createdAt, "dd.MM.yyyy")}</span>
    ),
  },
];
