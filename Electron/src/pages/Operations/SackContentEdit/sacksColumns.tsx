import type { ColumnDef } from "@tanstack/react-table";
import { MessageSquareText } from "lucide-react";
import { safeFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import { sackStatusLabels, sackStatusOf, type SackSearchRow } from "./types";

const fmtQty = (n: number) =>
  `${n.toLocaleString("tr-TR", { useGrouping: false, maximumFractionDigits: 1 })} m`;

/**
 * LOUD durum rozeti — Depoda (emerald) / Sevkte (violet=planlı) / Sevk Edildi (zinc).
 * ETİKET metni `sackStatusLabels`'tan (detay paneliyle tek kaynak); RENK burada
 * bilinçli olarak dolu/loud — listede tarama kolaylığı, panelde tonlu StatusBadge.
 */
const STATUS_CLASS: Record<ReturnType<typeof sackStatusOf>, string> = {
  POOL: "bg-emerald-600 text-white",
  PLANNED: "bg-violet-600 text-white",
  DISPATCHED: "bg-zinc-600 text-white",
};

function statusBadge(sack: SackSearchRow): { label: string; className: string } {
  const key = sackStatusOf(sack);
  return { label: sackStatusLabels[key], className: STATUS_CLASS[key] };
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
    cell: ({ row }) => {
      const b = row.original.branch;
      if (!b) return <span className="text-muted-foreground">—</span>;
      return (
        <span>
          {b.name}
          {b.code && (
            <span className="ml-1 font-mono text-xs text-muted-foreground">({b.code})</span>
          )}
        </span>
      );
    },
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
    // exportValue SAYI olmalı: eski `"5 +2 kartela"` metni summable ile birlikte
    // rawCellNumber'da rakamlara indirgenip "52" olurdu (5 top + 2 kartela → 52).
    // Kartela adedi hücrede ve içerik dökümünde görünür; bu kolon top sayar.
    meta: { label: "Top", summable: true, exportValue: (s) => s.rollCount },
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
    meta: { label: "Metraj", summable: true },
    cell: ({ row }) => (
      <span className="tabular-nums text-xs">{fmtQty(row.original.totalQty)}</span>
    ),
  },
  {
    id: "weightKg",
    header: "Kg",
    // Tartılmamış çuval toplamda 0 sayılır (null → 0) — toplam "tartılanların kg'ı".
    meta: { label: "Kg", summable: true },
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
    id: "note",
    header: "Not",
    meta: { label: "Not", exportValue: (s) => s.notePreview ?? "" },
    cell: ({ row }) => {
      const s = row.original;
      // Liste yalnız kırpılmış önizleme alır (notePreview, 80 karakter) — tam metin
      // çuval editöründe. Yorum yoksa sütun sessiz kalır.
      if (!s.hasNote) return <span className="text-muted-foreground">—</span>;
      return (
        <span
          className="flex max-w-[220px] items-center gap-1 text-xs text-muted-foreground"
          title={s.notePreview ?? undefined}
        >
          <MessageSquareText className="h-3 w-3 shrink-0" />
          <span className="truncate italic">{s.notePreview}</span>
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
