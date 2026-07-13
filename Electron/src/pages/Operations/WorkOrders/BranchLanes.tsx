import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CreditCard, Lock, Split, Truck, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { useOpenTarget } from "@/components/layout/tabs/use-tab-target";
import { safeFormat, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  workOrderService,
  type BatchLane,
  type BatchLaneDispatch,
  type BatchDispatchStatus,
  type WorkOrderLineageRef,
  type WorkOrderSplitChild,
} from "./service";
import { SplitBranchModal } from "./SplitBranchModal";
import { DirectShipModal } from "./DirectShipModal";
import { UndoTransferModal } from "./UndoTransferModal";

const STATUS_META: Record<BatchDispatchStatus, { label: string; cls: string }> = {
  OPEN: { label: "Fasonda", cls: "border-warning/40 bg-warning/10 text-warning" },
  PARTIAL: { label: "Kısmi dönüş", cls: "border-primary/40 bg-primary/10 text-primary" },
  RETURNED: { label: "Döndü", cls: "border-success/40 bg-success/10 text-success" },
  CANCELLED: { label: "İptal", cls: "border-border bg-muted text-muted-foreground" },
  DIRECT_SHIPPED: { label: "Doğrudan Sevk", cls: "border-primary/40 bg-primary/10 text-primary" },
};

/**
 * Parti lane'leri (Partiler paneli). Her lane = bir Batch (parti). Partinin üye
 * toplarının ŞU ANKİ konumu, aktif refakat kartı, fason sevkleri (K10: bir sevk =
 * bir parti) ve soy bağı tek bakışta görünür — "1. parti Kurşun'da, 2. parti hâlâ
 * boyahanede". Kilit türetilmiştir: iptal edilmemiş sevki olan parti kilitlidir.
 */
export function BranchLanes({ workOrderId }: { workOrderId: string }) {
  const q = useQuery({
    queryKey: ["work-order-branches", workOrderId],
    queryFn: () => workOrderService.getBranches(workOrderId),
    enabled: Boolean(workOrderId),
    staleTime: 60_000,
  });

  const [splitTarget, setSplitTarget] = useState<{ batchId: string; batchNumber: string } | null>(
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

  const batches = q.data?.data?.batches ?? [];
  const splitFrom = q.data?.data?.splitFrom ?? null;
  const splitChildren = q.data?.data?.splitChildren ?? [];

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (batches.length === 0 && splitChildren.length === 0 && !splitFrom) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs italic text-muted-foreground">
        Bu iş emrinde henüz parti yok.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {splitFrom && <WorkOrderSplitFromNote splitFrom={splitFrom} />}
      {batches.map((b) => (
        <BatchLaneCard
          key={b.batchId}
          batch={b}
          onSplit={() => setSplitTarget({ batchId: b.batchId, batchNumber: b.batchNumber })}
          onDirectShip={(d) =>
            setDirectShipTarget({ dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })
          }
          onUndoTransfer={(d) =>
            setUndoTarget({ dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })
          }
        />
      ))}
      {splitChildren.map((c) => (
        <WorkOrderSplitChildRow key={c.id} child={c} />
      ))}
      <SplitBranchModal
        open={Boolean(splitTarget)}
        onOpenChange={(o) => !o && setSplitTarget(null)}
        workOrderId={workOrderId}
        batchId={splitTarget?.batchId ?? ""}
        batchNumber={splitTarget?.batchNumber ?? ""}
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

function BatchLaneCard({
  batch,
  onSplit,
  onDirectShip,
  onUndoTransfer,
}: {
  batch: BatchLane;
  onSplit: () => void;
  onDirectShip: (d: BatchLaneDispatch) => void;
  onUndoTransfer: (d: BatchLaneDispatch) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        {/* Başlık: parti kodu + kilit + refakat kartı + Ayır */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-sm font-medium">{batch.batchNumber}</span>
          {batch.locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <Lock className="h-3 w-3" /> Sevkte
            </span>
          )}
          {batch.cardNumber && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              <span className="font-mono">{batch.cardNumber}</span>
            </span>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {safeFormat(batch.createdAt, "dd.MM.yyyy")}
          </span>
          {/* Ayır: modal parti durumundan izinli modları (redye/taşı) türetir. */}
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
        </div>

        {/* İçerik: parti toplarının şu anki konum dağılımı */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums">{batch.rollCount} top</span>
          {batch.currentPositions.length > 0 && (
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {batch.currentPositions.map((p) => (
            <span
              key={p.label}
              className="rounded bg-primary/10 px-1.5 py-0.5 tabular-nums text-primary"
            >
              {p.label}: {p.count} top · {formatNumber(p.totalMeters, 0)} m
            </span>
          ))}
        </div>

        {/* Soy bağı — aynı iş emri içinde redye ile ayrılan/kaynak parti */}
        {(batch.splitFrom || batch.splitChildren.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {batch.splitFrom && (
              <span className="inline-flex items-center gap-1">
                <Split className="h-3 w-3" />
                <span className="font-mono">{batch.splitFrom.batchNumber}</span>'ten ayrıldı
              </span>
            )}
            {batch.splitChildren.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3" />
                <span className="font-mono">{c.batchNumber}</span>'e ayrıldı
              </span>
            ))}
          </div>
        )}

        {/* Fason sevkleri (K10: bir sevk = bir parti) */}
        {batch.dispatches.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            {batch.dispatches.map((d) => (
              <BatchDispatchRow
                key={d.dispatchId}
                dispatch={d}
                onDirectShip={() => onDirectShip(d)}
                onUndoTransfer={() => onUndoTransfer(d)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BatchDispatchRow({
  dispatch,
  onDirectShip,
  onUndoTransfer,
}: {
  dispatch: BatchLaneDispatch;
  onDirectShip: () => void;
  onUndoTransfer: () => void;
}) {
  const meta = STATUS_META[dispatch.status];
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 text-xs",
        dispatch.status === "CANCELLED" && "opacity-60",
      )}
    >
      <span className="font-mono">{dispatch.dispatchNo}</span>
      <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls)}>
        {meta.label}
      </span>
      <span className="text-muted-foreground">
        {dispatch.subcontractorName}
        {dispatch.stepName ? ` · ${dispatch.stepName}` : ""}
      </span>
      <span className="tabular-nums text-muted-foreground">
        {dispatch.rollCount} parça · {formatNumber(dispatch.totalQty, 0)} m
      </span>
      <span className="ml-auto tabular-nums text-muted-foreground">
        {safeFormat(dispatch.dispatchedAt, "dd.MM.yyyy")}
      </span>
      {/* Doğrudan sevk: yalnız fasonda bekleyen (OPEN) sevkte. */}
      {dispatch.status === "OPEN" && (
        <PermissionGate permission="workorder:write">
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={onDirectShip}
          >
            <Truck className="h-3 w-3" />
            Doğrudan Sevk
          </Button>
        </PermissionGate>
      )}
      {/* Aktarımı geri al: yalnız fason→fason aktarım çıktısı + hâlâ fasonda (OPEN). */}
      {dispatch.status === "OPEN" && dispatch.isTransferOutput && (
        <PermissionGate permission="workorder:write">
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px]"
            onClick={onUndoTransfer}
          >
            <Undo2 className="h-3 w-3" />
            Aktarımı Geri Al
          </Button>
        </PermissionGate>
      )}
      {dispatch.receipts.length > 0 && (
        <div className="w-full text-[11px] text-muted-foreground">
          Dönüş:{" "}
          {dispatch.receipts
            .map((r) => `${r.receiptNo} (${safeFormat(r.receivedAt, "dd.MM.yyyy")})`)
            .join(", ")}
        </div>
      )}
    </div>
  );
}

/** "Bu iş emri İE-XXX'ten ayrıldı" — WO seviyesi (redye ile yeni WO'ya taşınma). */
function WorkOrderSplitFromNote({ splitFrom }: { splitFrom: WorkOrderLineageRef }) {
  const target = useOpenTarget();
  return (
    <button
      type="button"
      onClick={(e) => target(`/operations/work-orders/${splitFrom.id}`, e)}
      className="flex w-full items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60"
    >
      <Split className="h-3.5 w-3.5 shrink-0" />
      <span>
        Bu iş emri{" "}
        <span className="font-mono font-medium text-foreground">{splitFrom.workOrderNumber}</span>{" "}
        iş emrinden ayrılan bir partidir.
      </span>
      <ArrowUpRight className="ml-auto h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

/** "Ayrılan parti → İE-XXX" — WO seviyesi, ayrılıp yeni iş emrine giden partinin izi. */
function WorkOrderSplitChildRow({ child }: { child: WorkOrderSplitChild }) {
  const target = useOpenTarget();
  return (
    <button
      type="button"
      onClick={(e) => target(`/operations/work-orders/${child.id}`, e)}
      className="flex w-full items-center gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-left text-xs transition-colors hover:bg-primary/10"
    >
      <Split className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground">
        Ayrılan parti →{" "}
        <span className="font-mono font-medium text-foreground">{child.workOrderNumber}</span>
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
