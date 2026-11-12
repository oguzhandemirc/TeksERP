// Sevk partisi listesi — ortak DataTable sütunları. En üstteki "Partisiz çuvallar (havuz)" bir parti DEĞİL, havuzun
// kendisidir: aynı tabloda sabit ilk satır olarak durur (tonlu zemin + kesik alt çizgi), boşken soluk, KAYBOLMAZ.
// Sıralama bütün açık partiler bellekteyken yapılır (tek carinin açık partileri; sayfalı liste değil).
import { useMemo } from "react";
import type { ColumnDef, ColumnMeta } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Lock, PackageOpen } from "lucide-react";
import { useLocalTable } from "@/hooks/useLocalTable";
import { formatDisplay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { factoryLocaleDateString } from "@/lib/factory-time";
import { LotRowMenu } from "./PackingLotHeader";
import type { LotAction } from "./PackingLotActions";
import { lotSackLabel } from "./packingLotUi";
import type { LotSort, LotSortKey } from "./packingLotList";
import type { PackingGroup, PackingLotCustomerSummary } from "./types";

export const POOL_ROW_ID = "__pool__";
export type LotListRow = { id: typeof POOL_ROW_ID; pool: PackingLotCustomerSummary["ungrouped"] | undefined } | (PackingGroup & { pool?: never });

const isPool = (r: LotListRow): r is Extract<LotListRow, { id: typeof POOL_ROW_ID }> => r.id === POOL_ROW_ID;
const fmtQty = (n: number): string => formatDisplay(n, 1);
const fmtKg = (n: number | null): string => formatDisplay(n, 1);
const fmtDate = (iso: string): string => factoryLocaleDateString(iso, "tr-TR", { day: "2-digit", month: "2-digit" });

interface Opts {
  sort: LotSort;
  onSort: (key: LotSortKey) => void;
  onDone: () => void;
  onAction: (a: LotAction) => void;
}

/** Sıralanabilir başlık — aktif anahtarda yön oku. */
function SortButton({ label, active, onClick }: { label: string; active: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-0.5 hover:text-foreground", active && "text-foreground")}>
      {label}
      {active === "asc" && <ArrowUp className="h-3 w-3" />}
      {active === "desc" && <ArrowDown className="h-3 w-3" />}
    </button>
  );
}

function lotColumns({ sort, onSort, onDone, onAction }: Opts): ColumnDef<LotListRow>[] {
  const sorted = (key: LotSortKey, label: string, right = false, size?: number): { id: string; size?: number; meta: ColumnMeta<LotListRow, unknown>; header: () => React.ReactNode } => ({
    id: key,
    size,
    meta: { label, align: right ? "right" : undefined },
    header: () => <SortButton label={label} active={sort.key === key ? sort.dir : null} onClick={() => onSort(key)} />,
  });
  return [
    {
      ...sorted("name", "Parti", false, 240),
      meta: { label: "Parti", exportValue: (r) => (isPool(r) ? "Partisiz çuvallar (havuz)" : r.name) },
      cell: ({ row: { original: r } }) =>
        isPool(r) ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <PackageOpen className="h-3.5 w-3.5 text-muted-foreground" /> Partisiz çuvallar (havuz)
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium">
            {r.status === "CLOSED" && <Lock className="h-3 w-3" />}
            {r.name}
          </span>
        ),
    },
    { ...sorted("code", "Kod"), cell: ({ row: { original: r } }) => (isPool(r) ? null : <span className="font-mono text-xs text-muted-foreground">{r.code ?? ""}</span>) },
    {
      ...sorted("sackCount", "Çuval", true),
      cell: ({ row: { original: r } }) => <span className="tabular-nums">{isPool(r) ? (r.pool ? `${r.pool.sackCount} çuval` : "…") : lotSackLabel(r)}</span>,
    },
    {
      ...sorted("totalQty", "Metraj", true),
      cell: ({ row: { original: r } }) => <span className="tabular-nums">{isPool(r) ? (r.pool ? `${fmtQty(r.pool.totalQty)} m` : "") : `${fmtQty(r.totalQty)} m`}</span>,
    },
    { ...sorted("weightKg", "Kg", true), cell: ({ row: { original: r } }) => <span className="tabular-nums">{isPool(r) ? (r.pool ? fmtKg(r.pool.weightKg) : "") : fmtKg(r.weightKg)}</span> },
    { ...sorted("createdAt", "Tarih", true), cell: ({ row: { original: r } }) => (isPool(r) ? null : <span className="text-xs tabular-nums">{fmtDate(r.createdAt)}</span>) },
    { id: "note", header: "Not", size: 220, meta: { label: "Not", exportValue: (r) => (isPool(r) ? "" : (r.note ?? "")) }, cell: ({ row: { original: r } }) => (isPool(r) ? null : <span className="text-xs italic text-muted-foreground">{r.note ?? ""}</span>) },
    {
      id: "actions",
      header: () => <span className="sr-only">Eylemler</span>,
      enableHiding: false,
      size: 56,
      meta: { label: "Eylemler", align: "right" },
      cell: ({ row: { original: r } }) =>
        isPool(r) ? null : (
          <div onClick={(e) => e.stopPropagation()}>
            <LotRowMenu lot={r} onDone={onDone} onAction={onAction} />
          </div>
        ),
    },
  ];
}

export function usePackingLotTable(rows: LotListRow[], { sort, onSort, onDone, onAction }: Opts) {
  const columns = useMemo(() => lotColumns({ sort, onSort, onDone, onAction }), [sort, onSort, onDone, onAction]);
  return useLocalTable({ tableKey: "packing:lots", data: rows, columns });
}

export function lotRowClass(r: LotListRow): string | undefined {
  if (isPool(r)) {
    return cn(
      "border-b border-dashed bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50",
      (!r.pool || r.pool.sackCount === 0) && "text-muted-foreground",
    );
  }
  return r.status === "CLOSED" ? "text-muted-foreground" : undefined;
}
