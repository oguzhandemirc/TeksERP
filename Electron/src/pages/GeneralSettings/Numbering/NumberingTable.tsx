import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lockSentence, lockBadge, userCanResolve } from "./lockText";
import { LockInfo } from "./LockInfo";
import type { NumberSeriesRow } from "./types";
import { factoryLocaleDateString } from "@/lib/factory-time";

function SeriesCell({ row }: { row: NumberSeriesRow }) {
  const kilit = row.lockKind ? lockSentence(row) : null;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{row.label}</span>
      {kilit && row.lockKind && (
        <span className="inline-flex shrink-0 items-center gap-1">
          {/* Kullanıcının KENDİ çözebileceği kilit vurgulu rozet alır. */}
          <Badge variant={userCanResolve(row) ? "default" : "secondary"} className="shrink-0 px-1.5 py-0 text-[10px]">
            {lockBadge(row.lockKind)}
          </Badge>
          <LockInfo text={kilit} />
        </span>
      )}
    </span>
  );
}

const joinDot = (parts: string[]) => parts.filter(Boolean).join(" · ");
const exhaustionText = (r: NumberSeriesRow) =>
  r.exhaustion?.warn ? `${r.exhaustion.used ?? ""}/${r.exhaustion.limit ?? ""} — sınıra yaklaşıldı` : "";
const pendingText = (r: NumberSeriesRow) =>
  r.pending ? `${factoryLocaleDateString(r.pending.effectiveFrom, "tr-TR")} → ${r.pending.preview}` : "";

function PreviewCell({ row }: { row: NumberSeriesRow }) {
  const warn = exhaustionText(row);
  const pending = pendingText(row);
  return (
    <span className="truncate font-mono text-xs" title={joinDot([row.preview, warn, pending])}>
      {row.preview}
      {/* TÜKENME LİSTEDE de görünür (K8): biçimi kilitli seride kullanıcı kapasitenin dolduğunu başka yerde göremiyordu. */}
      {warn && <span className="ml-2 font-sans text-[10px] font-medium text-destructive">{warn}</span>}
      {pending && <span className="ml-2 font-sans text-[10px] text-amber-700 dark:text-amber-400">{pending}</span>}
    </span>
  );
}

function numberingColumns(h: { current: (row: NumberSeriesRow) => void }): ColumnDef<NumberSeriesRow>[] {
  return [
    { id: "label", header: "Seri", size: 300, meta: { label: "Seri", exportValue: (r) => r.label }, cell: ({ row }) => <SeriesCell row={row.original} /> },
    { id: "prefix", accessorKey: "prefix", header: "Ön ek", size: 96, meta: { label: "Ön ek" }, cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? "")}</span> },
    { id: "dateSegment", accessorKey: "dateSegment", header: "Tarih", size: 110, meta: { label: "Tarih" } },
    { id: "digits", accessorKey: "digits", header: "Hane", size: 72, meta: { label: "Hane", align: "right" } },
    {
      id: "preview",
      header: "Örnek",
      size: 340,
      meta: { label: "Örnek", exportValue: (r) => joinDot([r.preview, exhaustionText(r), pendingText(r)]) },
      cell: ({ row }) => <PreviewCell row={row.original} />,
    },
    {
      id: "actions",
      header: "",
      size: 104,
      enableHiding: false,
      meta: { label: "Düzenle", align: "right", exportValue: () => "" },
      // ⚠️ BİÇİM kilidi satırı kapatmaz: sayaç ayarları AYRI bir kilide tabi ve biçimi kilitli 46 seride AÇIK.
      // Yalnız `editable`a bakan bir düğme, motoru olan ama çıkış yüzeyi olmayan bir yetenek üretirdi.
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-7" disabled={!row.original.editable && !row.original.counter.startValue} onClick={() => h.current(row.original)}>
          Düzenle
        </Button>
      ),
    },
  ];
}

/**
 * Seri bölümü (başlık bandı + kenardan kenara tablo). ⚠️ KİLİTLİ SATIR DA ÇİZİLİR — süzgeç YOK; gerekçe sayfanın başlığında.
 * Bölümler aynı `tableKey`i paylaşır: sütun düzeni her bölümde aynıdır.
 */
export function NumberingTable({ rows, onEdit, title }: { rows: NumberSeriesRow[]; onEdit: (row: NumberSeriesRow) => void; title?: string }) {
  const ref = useRef(onEdit);
  ref.current = onEdit;
  const columns = useMemo(() => numberingColumns(ref), []);
  const table = useLocalTable({ tableKey: "numbering:series", data: rows, columns, getRowId: (r) => r.key });
  return (
    <section className="border-b last:border-b-0">
      <header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{rows.length} seri</span>
          <DataTableTools table={table} exportName={title ? `Numaralandırma - ${title}` : "Numaralandırma"} compact />
        </span>
      </header>
      <DataTable table={table} />
    </section>
  );
}
