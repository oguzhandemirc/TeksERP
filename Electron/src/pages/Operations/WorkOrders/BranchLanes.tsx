import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Split, Truck, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { safeFormat, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  workOrderService,
  type WorkOrderBranch,
  type WorkOrderSplitChild,
} from "./service";
import { SplitBranchModal } from "./SplitBranchModal";
import { DirectShipModal } from "./DirectShipModal";
import { UndoTransferModal } from "./UndoTransferModal";

const STATUS_META: Record<
  WorkOrderBranch["status"],
  { label: string; cls: string }
> = {
  OPEN: { label: "Fasonda", cls: "border-warning/40 bg-warning/10 text-warning" },
  PARTIAL: { label: "Kısmi dönüş", cls: "border-primary/40 bg-primary/10 text-primary" },
  RETURNED: { label: "Döndü", cls: "border-success/40 bg-success/10 text-success" },
  CANCELLED: { label: "İptal", cls: "border-border bg-muted text-muted-foreground" },
  DIRECT_SHIPPED: { label: "Doğrudan Sevk", cls: "border-primary/40 bg-primary/10 text-primary" },
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

  const [splitTarget, setSplitTarget] = useState<{ dispatchId: string; dispatchNo: string } | null>(
    null,
  );
  const [directShipTarget, setDirectShipTarget] = useState<{
    dispatchId: string;
    dispatchNo: string;
  } | null>(null);
  const [undoTarget, setUndoTarget] = useState<{
    dispatchId: string;
    dispatchNo: string;
  } | null>(null);

  const branches = q.data?.data?.branches ?? [];
  const splitFrom = q.data?.data?.splitFrom ?? null;
  const splitChildren = q.data?.data?.splitChildren ?? [];

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (branches.length === 0 && splitChildren.length === 0 && !splitFrom) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs italic text-muted-foreground">
        Bu iş emrinde henüz fason sevki (dal) yok.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {splitFrom && <SplitFromNote splitFrom={splitFrom} />}
      {branches.map((b) => (
        <BranchLaneRow
          key={b.dispatchId}
          branch={b}
          onSplit={() => setSplitTarget({ dispatchId: b.dispatchId, dispatchNo: b.dispatchNo })}
          onDirectShip={() =>
            setDirectShipTarget({ dispatchId: b.dispatchId, dispatchNo: b.dispatchNo })
          }
          onUndoTransfer={() =>
            setUndoTarget({ dispatchId: b.dispatchId, dispatchNo: b.dispatchNo })
          }
        />
      ))}
      {splitChildren.map((c) => (
        <SplitChildRow key={c.id} child={c} />
      ))}
      <SplitBranchModal
        open={Boolean(splitTarget)}
        onOpenChange={(o) => !o && setSplitTarget(null)}
        workOrderId={workOrderId}
        dispatchId={splitTarget?.dispatchId ?? ""}
        dispatchNo={splitTarget?.dispatchNo ?? ""}
      />
      <DirectShipModal
        open={Boolean(directShipTarget)}
        onOpenChange={(o) => !o && setDirectShipTarget(null)}
        workOrderId={workOrderId}
        dispatchId={directShipTarget?.dispatchId ?? ""}
        dispatchNo={directShipTarget?.dispatchNo ?? ""}
      />
      <UndoTransferModal
        open={Boolean(undoTarget)}
        onOpenChange={(o) => !o && setUndoTarget(null)}
        workOrderId={workOrderId}
        dispatchId={undoTarget?.dispatchId ?? ""}
        dispatchNo={undoTarget?.dispatchNo ?? ""}
      />
    </div>
  );
}

/** "Bu iş emri P-XXX'ten ayrıldı" — yeni WO'da kaynağa dönüş izi. */
function SplitFromNote({ splitFrom }: { splitFrom: { id: string; batchNumber: string } }) {
  const target = useOpenTarget();
  return (
    <button
      type="button"
      onClick={(e) => target(`/operations/work-orders/${splitFrom.id}`, e)}
      className="flex w-full items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60"
    >
      <Split className="h-3.5 w-3.5 shrink-0" />
      <span>
        Bu iş emri <span className="font-mono font-medium text-foreground">{splitFrom.batchNumber}</span>{" "}
        iş emrinden ayrılan bir partidir.
      </span>
      <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

/** "Ayrılan parti → P-XXX" — kaynak WO'da, ayrılıp giden partinin izi. Sevk yeni
 *  WO'ya taşındığı için lane buradan kaybolur; bu satır "nereye gitti?"yi yanıtlar. */
function SplitChildRow({ child }: { child: WorkOrderSplitChild }) {
  const target = useOpenTarget();
  return (
    <button
      type="button"
      onClick={(e) => target(`/operations/work-orders/${child.id}`, e)}
      className="flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/10"
    >
      <Split className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground">
        Ayrılan parti → <span className="font-mono font-medium text-foreground">{child.batchNumber}</span>
      </span>
      {child.targetColor && (
        <span className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]">
          {child.targetColor.hex && (
            <span
              className="h-2 w-2 rounded-full border"
              style={{ backgroundColor: child.targetColor.hex }}
            />
          )}
          {child.targetColor.name}
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 tabular-nums text-muted-foreground">
        {safeFormat(child.createdAt, "dd.MM.yyyy")}
        <ArrowUpRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function BranchLaneRow({
  branch,
  onSplit,
  onDirectShip,
  onUndoTransfer,
}: {
  branch: WorkOrderBranch;
  onSplit: () => void;
  onDirectShip: () => void;
  onUndoTransfer: () => void;
}) {
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
          {/* Ayır: iptal olmayan partiler — boyanmadan (OPEN) devam ya da
              boyandıysa (PARTIAL/RETURNED) yeniden boyama. Modal uygunluğu doğrular. */}
          {branch.status !== "CANCELLED" && branch.status !== "DIRECT_SHIPPED" && (
            <PermissionGate permission="workorder:write">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onSplit}
              >
                <Split className="h-3.5 w-3.5" />
                Ayır
              </Button>
            </PermissionGate>
          )}
          {/* Doğrudan sevk: yalnız fasonda bekleyen (OPEN) sevkte — mal dönmeden
              müşteriye gittiyse manuel kapat. */}
          {branch.status === "OPEN" && (
            <PermissionGate permission="workorder:write">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onDirectShip}
              >
                <Truck className="h-3.5 w-3.5" />
                Doğrudan Sevk
              </Button>
            </PermissionGate>
          )}
          {/* Aktarımı geri al: yalnız fason→fason aktarım çıktısı + henüz fasonda
              bekleyen (OPEN) dalda — yanlışlıkla sonraki fasona aktarıldıysa kaynağa geri sar. */}
          {branch.status === "OPEN" && branch.isTransferOutput && (
            <PermissionGate permission="workorder:write">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onUndoTransfer}
              >
                <Undo2 className="h-3.5 w-3.5" />
                Aktarımı Geri Al
              </Button>
            </PermissionGate>
          )}
        </div>

        {/* Mini-track: Sevk → (Fasonda | şu anki konum) */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">
            Sevk: {branch.rollCount} parça · {formatNumber(branch.totalQty, 0)} m
          </span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          {branch.status === "OPEN" ? (
            <span className="text-warning">Boyahanede — dönüş bekleniyor</span>
          ) : branch.status === "DIRECT_SHIPPED" ? (
            <span className="text-primary">Fasondan doğrudan sevk edildi (müşteriye)</span>
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
