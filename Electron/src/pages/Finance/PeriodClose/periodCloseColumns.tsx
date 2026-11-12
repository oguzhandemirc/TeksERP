// Dönem kapanışı (cari) — ortak DataTable sütunları. Yeniden açılmış satır soluk çizilir ve "Doğrula"/"Yeniden Aç"
// taşımaz (gerekçe sayfa başlığında); eylemler diyalog açar, geri çağrılar ref'te (sütunlar bir kez kurulur).
import { useMemo, useRef } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, Unlock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { useLocalTable } from "@/hooks/useLocalTable";
import { formatDayKey, formatInstant, moneyOf, type PeriodCloseRow } from "./service";

interface Handlers {
  onVerify: (r: PeriodCloseRow) => void;
  onReopen: (r: PeriodCloseRow) => void;
}

const reopenText = (r: PeriodCloseRow) => (r.reopenedAt ? `Açılma: ${formatInstant(r.reopenedAt)} — ${r.reopenReason ?? "gerekçe yok"}` : "");
const noteText = (r: PeriodCloseRow) => [r.notes ?? "", reopenText(r)].filter(Boolean).join(" · ");

function PeriodEndCell({ r }: { r: PeriodCloseRow }) {
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">{formatDayKey(r.periodEnd)}</span>
      {r.reopenedAt && <Badge className="shrink-0 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">Yeniden açıldı</Badge>}
    </span>
  );
}

function NoteCell({ r }: { r: PeriodCloseRow }) {
  const reopen = reopenText(r);
  return (
    <span className="truncate text-muted-foreground" title={noteText(r) || undefined}>
      {r.notes ?? "—"}
      {reopen && <span className="ml-2 text-xs text-amber-700 dark:text-amber-500">{reopen}</span>}
    </span>
  );
}

function ActionsCell({ r, h }: { r: PeriodCloseRow; h: Handlers }) {
  if (r.reopenedAt) return null;
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="outline" size="icon" className="h-7 w-7" title="Mühürlü rakamı bugünkü defterle karşılaştır (salt okuma)" aria-label="Doğrula" onClick={() => h.onVerify(r)}>
        <ShieldCheck className="h-4 w-4" />
      </Button>
      <PermissionGate permission="finance:close">
        <Button variant="outline" size="sm" className="h-7" onClick={() => h.onReopen(r)}>
          <Unlock className="mr-1 h-3.5 w-3.5" />
          Yeniden Aç
        </Button>
      </PermissionGate>
    </div>
  );
}

function periodCloseColumns(h: { current: Handlers }): ColumnDef<PeriodCloseRow>[] {
  return [
    {
      id: "cari",
      header: "Cari",
      size: 280,
      meta: { label: "Cari", exportValue: (r) => `${r.cariCode} — ${r.cariName}` },
      cell: ({ row }) => (
        <span className="truncate">
          <span className="font-medium">{row.original.cariName}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{row.original.cariCode}</span>
        </span>
      ),
    },
    { id: "currency", accessorKey: "currency", header: "Para", size: 72, meta: { label: "Para" } },
    { id: "periodEnd", header: "Dönem sonu", size: 200, meta: { label: "Dönem sonu", exportValue: (r) => formatDayKey(r.periodEnd) }, cell: ({ row }) => <PeriodEndCell r={row.original} /> },
    {
      id: "closingBalance",
      header: "Mühürlü bakiye",
      size: 160,
      meta: { label: "Mühürlü bakiye", align: "right", exportValue: (r) => moneyOf(r.closingBalance, r.currency) },
      cell: ({ row }) => <span className="font-medium tabular-nums">{moneyOf(row.original.closingBalance, row.original.currency)}</span>,
    },
    { id: "txnCount", accessorKey: "txnCount", header: "Hareket", size: 96, meta: { label: "Hareket", align: "right" } },
    { id: "createdAt", header: "Kapatıldı", size: 160, meta: { label: "Kapatıldı", exportValue: (r) => formatInstant(r.createdAt) }, cell: ({ row }) => <span className="text-muted-foreground">{formatInstant(row.original.createdAt)}</span> },
    { id: "notes", header: "Not", size: 320, meta: { label: "Not", exportValue: noteText }, cell: ({ row }) => <NoteCell r={row.original} /> },
    {
      id: "actions",
      header: "",
      size: 150,
      enableHiding: false,
      meta: { label: "Eylemler", align: "right", exportValue: () => "" },
      cell: ({ row }) => <ActionsCell r={row.original} h={h.current} />,
    },
  ];
}

export function usePeriodCloseTable(rows: PeriodCloseRow[], handlers: Handlers) {
  const ref = useRef<Handlers>(handlers);
  ref.current = handlers;
  const columns = useMemo(() => periodCloseColumns(ref), []);
  return useLocalTable({ tableKey: "finance:period-closes", data: rows, columns });
}
