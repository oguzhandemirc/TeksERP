// Açık fason sevkleri: gecikme vurgusu (kırmızı satır şeridi + rozet), kısmi kabul sonrası kalan, iplik/levent bakiyesi.
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { fmtFactoryDate } from "@/lib/factory-time";
import { cn } from "@/lib/utils";
import { dueText, dueTone, fmtQty } from "./cockpit-labels";
import type { SubcontractorCockpitRow } from "./types";

const TONE_BADGE = {
  overdue: "border-destructive/40 bg-destructive/10 text-destructive",
  soon: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  ok: "border-border text-muted-foreground",
  none: "border-dashed text-muted-foreground",
} as const;

function OrderCell({ r }: { r: SubcontractorCockpitRow }) {
  if (r.workOrder) {
    return (
      <Link to={`/operations/work-orders/${r.workOrder.id}`} className="font-mono text-primary hover:underline">
        {r.workOrder.orderNo}
      </Link>
    );
  }
  if (r.weavingOrder) return <span className="font-mono">{r.weavingOrder.orderNo} <span className="font-sans text-muted-foreground">(dokuma)</span></span>;
  return <span className="text-muted-foreground">—</span>;
}

/** Fasoncudaki iplik/levent bakiyesi metni — hücre ve dışa aktarım aynı metni kullanır ("" = bakiye yok). */
function extraBalanceText(r: SubcontractorCockpitRow): string {
  const kg = Number(r.yarnOutstandingKg);
  const parts: string[] = [];
  if (kg > 0) parts.push(`${fmtQty(kg, 1)} kg iplik`);
  if (r.beamOutstandingCount > 0) parts.push(`${r.beamOutstandingCount} levent`);
  return parts.join(" · ");
}

function ExtraBalance({ r }: { r: SubcontractorCockpitRow }) {
  const text = extraBalanceText(r);
  if (!text) return <span className="text-muted-foreground">—</span>;
  return <span className="whitespace-nowrap tabular-nums">{text}</span>;
}

const qtyOrDash = (r: SubcontractorCockpitRow, v: number | string) => (Number(r.dispatchedQty) > 0 ? `${fmtQty(v)} m` : "—");

export const COCKPIT_COLUMNS: ColumnDef<SubcontractorCockpitRow>[] = [
  { accessorKey: "dispatchNo", header: "Sevk no", cell: ({ row }) => <span className="font-mono text-xs">{row.original.dispatchNo}</span> },
  { id: "subcontractor", header: "Firma", size: 200, meta: { label: "Firma", exportValue: (r) => r.subcontractor.name }, cell: ({ row }) => <span className="font-medium">{row.original.subcontractor.name}</span> },
  { id: "category", header: "Süreç türü", meta: { label: "Süreç türü", exportValue: (r) => r.category?.name ?? "" }, cell: ({ row }) => row.original.category?.name ?? <span className="text-muted-foreground">—</span> },
  {
    id: "order",
    header: "Emir",
    meta: { label: "Emir", exportValue: (r) => r.workOrder?.orderNo ?? r.weavingOrder?.orderNo ?? "" },
    cell: ({ row }) => (
      <span className="text-xs" onClick={(e) => e.stopPropagation()}>
        <OrderCell r={row.original} />
      </span>
    ),
  },
  { id: "dispatchedAt", header: "Sevk", meta: { label: "Sevk", exportValue: (r) => fmtFactoryDate(r.dispatchedAt) }, cell: ({ row }) => <span className="tabular-nums">{fmtFactoryDate(row.original.dispatchedAt)}</span> },
  {
    id: "expectedReturnAt",
    header: "Termin",
    size: 200,
    meta: { label: "Termin", exportValue: (r) => `${r.expectedReturnAt ? fmtFactoryDate(r.expectedReturnAt) : ""} ${dueText(r)}`.trim() },
    cell: ({ row: { original: r } }) => (
      <span className="inline-flex items-center gap-1.5">
        <span className="tabular-nums">{r.expectedReturnAt ? fmtFactoryDate(r.expectedReturnAt) : "—"}</span>
        <Badge variant="outline" className={cn("text-[10px]", TONE_BADGE[dueTone(r)])}>
          {dueText(r)}
        </Badge>
      </span>
    ),
  },
  // İplik/levent sevkinde kumaş metresi yoktur — "0 m · 0 top" yerine boş geçilir.
  { id: "dispatchedQty", header: "Giden", meta: { label: "Giden", align: "right", exportValue: (r) => qtyOrDash(r, r.dispatchedQty) }, cell: ({ row }) => <span className="tabular-nums">{qtyOrDash(row.original, row.original.dispatchedQty)}</span> },
  {
    id: "outstandingQty",
    header: "Fasonda kalan",
    size: 170,
    meta: { label: "Fasonda kalan", align: "right", exportValue: (r) => qtyOrDash(r, r.outstandingQty) },
    cell: ({ row: { original: r } }) =>
      Number(r.dispatchedQty) > 0 ? (
        <span className="tabular-nums">
          <span className="mr-1.5 text-xs text-muted-foreground">{r.outstandingRollCount} top</span>
          {fmtQty(r.outstandingQty)} m
        </span>
      ) : (
        "—"
      ),
  },
  { id: "extra", header: "İplik / levent", meta: { label: "İplik / levent", exportValue: (r: SubcontractorCockpitRow) => extraBalanceText(r) || "—" }, cell: ({ row }) => <span className="text-xs"><ExtraBalance r={row.original} /></span> },
];

export const cockpitRowClass = (r: SubcontractorCockpitRow) =>
  dueTone(r) === "overdue" ? "bg-destructive/5 shadow-[inset_3px_0_0_hsl(var(--destructive))]" : undefined;
