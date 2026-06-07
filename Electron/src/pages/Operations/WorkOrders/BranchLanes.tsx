import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { safeFormat, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workOrderService, type WorkOrderBranch } from "./service";

const STATUS_META: Record<
  WorkOrderBranch["status"],
  { label: string; cls: string }
> = {
  OPEN: { label: "Fasonda", cls: "border-warning/40 bg-warning/10 text-warning" },
  PARTIAL: { label: "Kısmi dönüş", cls: "border-primary/40 bg-primary/10 text-primary" },
  RETURNED: { label: "Döndü", cls: "border-success/40 bg-success/10 text-success" },
  CANCELLED: { label: "İptal", cls: "border-border bg-muted text-muted-foreground" },
};

/**
 * Fason dalları (lane / swimlane). Her dal = bir sevk partisi
 * (SubcontractorDispatch). Aynı WO'da kumaş parça parça fasona gidince her
 * parti kendi satırında durumuyla (Fasonda / Döndü / Kısmi) ve dönüşten doğan
 * topların şu anki konumuyla görünür — "1. parti Kurşun'da, 2. parti hâlâ
 * boyahanede" gibi paralel akışlar tek bakışta okunur.
 */
export function BranchLanes({ workOrderId }: { workOrderId: string }) {
  const q = useQuery({
    queryKey: ["work-order-branches", workOrderId],
    queryFn: () => workOrderService.getBranches(workOrderId),
    enabled: Boolean(workOrderId),
    staleTime: 60_000,
  });

  const branches = q.data?.data?.branches ?? [];

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (branches.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs italic text-muted-foreground">
        Bu iş emrinde henüz fason sevki (dal) yok.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {branches.map((b) => (
        <BranchLaneRow key={b.dispatchId} branch={b} />
      ))}
    </div>
  );
}

function BranchLaneRow({ branch }: { branch: WorkOrderBranch }) {
  const meta = STATUS_META[branch.status];

  return (
    <Card className={cn(branch.status === "CANCELLED" && "opacity-60")}>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-sm font-medium">{branch.dispatchNo}</span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              meta.cls,
            )}
          >
            {meta.label}
          </span>
          <span className="text-xs text-muted-foreground">
            {branch.subcontractorName}
            {branch.stepName ? ` · ${branch.stepName}` : ""}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {safeFormat(branch.dispatchedAt, "dd.MM.yyyy")}
          </span>
        </div>

        {/* Mini-track: Sevk → (Fasonda | şu anki konum) */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
            Sevk: {branch.rollCount} parça · {formatNumber(branch.totalQty, 0)} m
          </span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          {branch.status === "OPEN" ? (
            <span className="text-warning">Boyahanede — dönüş bekleniyor</span>
          ) : branch.currentPositions.length > 0 ? (
            branch.currentPositions.map((p) => (
              <span
                key={p.label}
                className="rounded bg-primary/10 px-1.5 py-0.5 tabular-nums text-primary"
              >
                {p.label}: {p.count} top · {formatNumber(p.totalMeters, 0)} m
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">Döndü (çıktı izlenmiyor)</span>
          )}
        </div>

        {branch.receipts.length > 0 && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Dönüş:{" "}
            {branch.receipts
              .map((r) => `${r.receiptNo} (${safeFormat(r.receivedAt, "dd.MM.yyyy")})`)
              .join(", ")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
