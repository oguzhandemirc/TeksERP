// Açık fason sevkleri: gecikme vurgusu (kırmızı satır şeridi + rozet), kısmi kabul sonrası kalan, iplik/levent bakiyesi.
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

function ExtraBalance({ r }: { r: SubcontractorCockpitRow }) {
  const kg = Number(r.yarnOutstandingKg);
  if (kg <= 0 && r.beamOutstandingCount <= 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {kg > 0 && `${fmtQty(kg, 1)} kg iplik`}
      {kg > 0 && r.beamOutstandingCount > 0 && " · "}
      {r.beamOutstandingCount > 0 && `${r.beamOutstandingCount} levent`}
    </span>
  );
}

export function CockpitTable({ rows }: { rows: SubcontractorCockpitRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="px-3 py-2">Sevk no</th>
          <th className="px-3 py-2">Firma</th>
          <th className="px-3 py-2">Süreç türü</th>
          <th className="px-3 py-2">Emir</th>
          <th className="px-3 py-2">Sevk</th>
          <th className="px-3 py-2">Termin</th>
          <th className="px-3 py-2 text-right">Giden</th>
          <th className="px-3 py-2 text-right">Fasonda kalan</th>
          <th className="px-3 py-2">İplik / levent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = dueTone(r);
          return (
            <tr key={r.dispatchId} className={cn("border-b hover:bg-muted/40", tone === "overdue" && "bg-destructive/5 shadow-[inset_3px_0_0_hsl(var(--destructive))]")}>
              <td className="px-3 py-2 font-mono text-xs">{r.dispatchNo}</td>
              <td className="px-3 py-2 font-medium">{r.subcontractor.name}</td>
              <td className="px-3 py-2">{r.category?.name ?? <span className="text-muted-foreground">—</span>}</td>
              <td className="px-3 py-2 text-xs"><OrderCell r={r} /></td>
              <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtFactoryDate(r.dispatchedAt)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-col items-start gap-0.5">
                  <span className="whitespace-nowrap tabular-nums">{r.expectedReturnAt ? fmtFactoryDate(r.expectedReturnAt) : "—"}</span>
                  <Badge variant="outline" className={cn("text-[10px]", TONE_BADGE[tone])}>{dueText(r)}</Badge>
                </div>
              </td>
              {/* İplik/levent sevkinde kumaş metresi yoktur — "0 m · 0 top" yerine boş geçilir. */}
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{Number(r.dispatchedQty) > 0 ? `${fmtQty(r.dispatchedQty)} m` : "—"}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                {Number(r.dispatchedQty) > 0 ? (
                  <>
                    {fmtQty(r.outstandingQty)} m
                    <span className="block text-xs text-muted-foreground">{r.outstandingRollCount} top</span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2 text-xs"><ExtraBalance r={r} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
