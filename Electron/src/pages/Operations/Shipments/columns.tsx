import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { ReturnsBadge } from "@/components/operations/ReturnsBadge";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat, formatNumber } from "@/lib/format";
import { shipmentStatusLabels, shipmentStatusTones, type ShipmentListItem } from "./types";

export const shipmentColumns: ColumnDef<ShipmentListItem>[] = [
  {
    accessorKey: "shipmentNo",
    header: () => <SortableHeader field="shipmentNo" label="Sevkiyat No" />,
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs font-semibold">{s.shipmentNo}</span>
          {s.kind === "DIRECT" && (
            <Badge variant="outline" className="border-amber-500/40 text-[10px] text-amber-600">
              Fasondan Sevk
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    id: "customer",
    header: "Müşteri",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <div className="min-w-0">
          <div className="truncate font-medium">{s.customer.name}</div>
          {s.branch && (
            <div className="truncate text-xs text-muted-foreground">
              {s.branch.name}
              {s.branch.code && (
                <span className="ml-1 font-mono text-[10px] text-foreground/70">· {s.branch.code}</span>
              )}
            </div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />
    ),
  },
  {
    id: "counts",
    header: "İçerik",
    cell: ({ row }) => {
      const c = row.original._count;
      const isDirect = row.original.kind === "DIRECT";
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {/* Doğrudan sevkte çuval yok — top (+ karşılanan sipariş) gösterilir. */}
          {isDirect
            ? `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`
            : `${c.orders} sipariş · ${c.rolls} top · ${c.sacks} çuval`}
          <ReturnsBadge count={c.returns} />
          {/* Yalnız kumaş/renk filtresi aktifken: bu sevkiyattaki eşleşen top sayısı. */}
          {row.original.matchRollCount != null && (
            <Badge
              variant="outline"
              className="gap-0.5 border-amber-500/50 bg-amber-500/10 px-1 py-0 text-[10px] font-medium text-amber-600"
              title="Kumaş/renk filtresine uyan (eşleşen) top sayısı — detayda vurgulanır"
            >
              eşleşen: {row.original.matchRollCount} top
            </Badge>
          )}
        </span>
      );
    },
  },
  {
    id: "totals",
    header: "Metraj / Kg",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {formatNumber(s.totalMeters, 0)} m
          {s.totalKg > 0 && (
            <span className="text-muted-foreground"> · {formatNumber(s.totalKg, 1)} kg</span>
          )}
        </span>
      );
    },
  },
  {
    id: "vehicle",
    header: "Araç / Sürücü",
    cell: ({ row }) => {
      const s = row.original;
      if (!s.plateNumber && !s.driverName) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-xs">
          {s.plateNumber ?? ""}
          {s.driverName ? ` · ${s.driverName}` : ""}
        </span>
      );
    },
  },
  {
    id: "date",
    header: () => <SortableHeader field="createdAt" label="Tarih" />,
    cell: ({ row }) => {
      const s = row.original;
      const d = s.dispatchedAt ?? s.createdAt;
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">{safeFormat(d, "dd.MM.yyyy HH:mm")}</span>
      );
    },
  },
  {
    // FATURA İZİ — ERP fatura KESMEZ; bu kolon dış muhasebe programındaki belgenin
    // izini gösterir. Yalnız ÇIKMIŞ sevkiyat faturalanabilir: PLANNED satırda soru
    // henüz anlamsız olduğu için "—" basılır (kırmızı "Kesilmedi" rozetini iş
    // listesi sanmasınlar diye — sevk edilmemiş mal zaten faturalanmaz).
    id: "invoice",
    header: "Fatura",
    cell: ({ row }) => {
      const s = row.original;
      if (s.status !== "DISPATCHED") {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      if (!s.invoiceNo) {
        return (
          <Badge variant="outline" className="whitespace-nowrap text-[10px] text-muted-foreground">
            Kesilmedi
          </Badge>
        );
      }
      return (
        <div className="flex flex-col gap-0.5">
          <span className="whitespace-nowrap text-xs font-medium tabular-nums">{s.invoiceNo}</span>
          {s.invoicedAt && (
            <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
              {safeFormat(s.invoicedAt, "dd.MM.yyyy")}
            </span>
          )}
        </div>
      );
    },
  },
];
