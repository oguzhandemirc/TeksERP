import type { ColumnDef } from "@tanstack/react-table";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { ReturnsBadge } from "@/components/operations/ReturnsBadge";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { safeFormat, formatNumber, formatFixed } from "@/lib/format";
import { shipmentStatusLabels, shipmentStatusTones, type ShipmentListItem } from "./types";
import { EIrsaliyeStatusBadge } from "./eirsaliye/EIrsaliyeStatusBadge";

// Dışa aktarım metinleri — hücreyle aynı kaynak (hücre bu fonksiyonları çağırır).
type S = ShipmentListItem;
const branchText = (s: S) => (s.branch ? `${s.branch.name}${s.branch.code ? ` · ${s.branch.code}` : ""}` : "");
const countsText = (s: S) => {
  const c = s._count;
  return s.kind === "DIRECT"
    ? `${c.rolls} top${c.orders > 0 ? ` · ${c.orders} sipariş` : ""}`
    : `${c.orders} sipariş · ${c.rolls} top · ${c.sacks} çuval`;
};
const kgText = (s: S) => (s.totalKg > 0 ? `${formatNumber(s.totalKg, 1)} kg` : "");
const metersText = (s: S) => `${formatFixed(s.totalMeters, 2)} m`;
const vehicleText = (s: S) => [s.plateNumber, s.driverName].filter(Boolean).join(" · ");
const dateText = (s: S) => safeFormat(s.dispatchedAt ?? s.createdAt, "dd.MM.yyyy HH:mm");
/** Fatura izi: yalnız çıkmış sevkiyatta anlamlı (PLANNED'da "—"). */
const invoiceText = (s: S) => {
  if (s.status !== "DISPATCHED") return "";
  if (!s.invoiceNo) return "Kesilmedi";
  return s.invoicedAt ? `${s.invoiceNo} (${safeFormat(s.invoicedAt, "dd.MM.yyyy")})` : s.invoiceNo;
};

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
    meta: {
      label: "Müşteri",
      exportValue: (s: S) => [s.customer.name, branchText(s)].filter(Boolean).join(" / "),
    },
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
    meta: { label: "Durum", exportValue: (s: S) => shipmentStatusLabels[s.status] ?? s.status },
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={row.original.status} labels={shipmentStatusLabels} tones={shipmentStatusTones} />
        {/* e-İrsaliye rozeti yalnız kaydı olan satırda (kayıtsız kurulumda DOM aynı); ayrı kolon
            açılmadı — kolon yapılandırılmamış kurulumda boş sütun olurdu. */}
        {row.original.eIrsaliyeStatus && (
          <span title="e-İrsaliye durumu" className="inline-flex items-center gap-0.5 whitespace-nowrap text-[10px] text-muted-foreground">
            e-İrs.
            <EIrsaliyeStatusBadge status={row.original.eIrsaliyeStatus} simulasyon={row.original.eIrsaliyeSimulasyon} className="px-1 py-0 text-[10px]" />
          </span>
        )}
      </div>
    ),
  },
  {
    id: "counts",
    header: "İçerik",
    meta: { label: "İçerik", exportValue: countsText },
    cell: ({ row }) => {
      const c = row.original._count;
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {/* Doğrudan sevkte çuval yok — top (+ karşılanan sipariş) gösterilir. */}
          {countsText(row.original)}
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
    meta: { label: "Metraj / Kg", exportValue: (s: S) => [metersText(s), kgText(s)].filter(Boolean).join(" · ") },
    cell: ({ row }) => {
      const s = row.original;
      const kg = kgText(s);
      return (
        <span className="whitespace-nowrap text-xs tabular-nums">
          {metersText(s)}
          {kg && <span className="text-muted-foreground"> · {kg}</span>}
        </span>
      );
    },
  },
  {
    id: "vehicle",
    header: "Araç / Sürücü",
    meta: { label: "Araç / Sürücü", exportValue: vehicleText },
    cell: ({ row }) => {
      const text = vehicleText(row.original);
      return text ? <span className="text-xs">{text}</span> : <span className="text-muted-foreground">—</span>;
    },
  },
  {
    id: "date",
    header: () => <SortableHeader field="createdAt" label="Tarih" />,
    meta: { label: "Tarih", exportValue: dateText },
    cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums">{dateText(row.original)}</span>,
  },
  {
    // FATURA İZİ — ERP fatura KESMEZ; bu kolon dış muhasebe programındaki belgenin
    // izini gösterir. Yalnız ÇIKMIŞ sevkiyat faturalanabilir: PLANNED satırda soru
    // henüz anlamsız olduğu için "—" basılır (kırmızı "Kesilmedi" rozetini iş
    // listesi sanmasınlar diye — sevk edilmemiş mal zaten faturalanmaz).
    id: "invoice",
    header: "Fatura",
    meta: { label: "Fatura", exportValue: invoiceText },
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
