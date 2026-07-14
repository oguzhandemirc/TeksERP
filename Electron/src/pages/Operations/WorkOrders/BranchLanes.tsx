import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  GitMerge,
  Lock,
  Printer,
  RefreshCw,
  Split,
  Truck,
  Undo2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
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
import { TebdilWizard } from "./tebdil/TebdilWizard";
import { DirectShipModal } from "./DirectShipModal";
import { UndoTransferModal } from "./UndoTransferModal";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { BatchCorrectModal } from "./BatchCorrectModal";
import { Wrench } from "lucide-react";

const STATUS_META: Record<BatchDispatchStatus, { label: string; cls: string }> = {
  OPEN: { label: "Fasonda", cls: "border-warning/40 bg-warning/10 text-warning" },
  PARTIAL: { label: "Kısmi dönüş", cls: "border-primary/40 bg-primary/10 text-primary" },
  RETURNED: { label: "Döndü", cls: "border-success/40 bg-success/10 text-success" },
  CANCELLED: { label: "İptal", cls: "border-border bg-muted text-muted-foreground" },
  DIRECT_SHIPPED: { label: "Doğrudan Sevk", cls: "border-primary/40 bg-primary/10 text-primary" },
};

/**
 * Parti lane'leri (Partiler paneli). Her lane = BAĞIMSIZ bir Batch (parti):
 * "N. Parti" başlığı + belirgin ayrım. Üye topların konumu, fason sevkleri (K10),
 * her sevkin belgesi (irsaliye) ve soy bağı görünür. Sevksiz partiler çoklu seçilip
 * BİRLEŞTİRİLEBİLİR (K8, en eski no yaşar). Refakat kartı iş emri başına olduğundan
 * lane'de tekrarlanmaz (başlıkta bir kez). Kilit türetilmiş (açık sevk = kilitli).
 */
export function BranchLanes({ workOrderId }: { workOrderId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["work-order-branches", workOrderId],
    queryFn: () => workOrderService.getBranches(workOrderId),
    enabled: Boolean(workOrderId),
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [tebdilTarget, setTebdilTarget] = useState<{
    batchId: string;
    batchNumber: string;
    dispatchOnly?: boolean;
  } | null>(null);
  const [directShipTarget, setDirectShipTarget] = useState<{
    dispatchId: string;
    dispatchNo: string;
  } | null>(null);
  const [undoTarget, setUndoTarget] = useState<{ dispatchId: string; dispatchNo: string } | null>(
    null,
  );
  const [printDispatchId, setPrintDispatchId] = useState<string | null>(null);
  const [correctTarget, setCorrectTarget] = useState<{ batchId: string; batchNumber: string } | null>(
    null,
  );

  const batches = q.data?.data?.batches ?? [];
  const splitFrom = q.data?.data?.splitFrom ?? null;
  const splitChildren = q.data?.data?.splitChildren ?? [];

  // K8 birleştirme: yalnız sevksiz (kilitsiz) partiler seçilebilir; ≥2 sevksiz varsa aktif.
  const unlockedCount = batches.filter((b) => !b.locked).length;
  const canSelect = unlockedCount >= 2;
  const selectedBatches = batches.filter((b) => selected.has(b.batchId));
  const survivor = selectedBatches[0]; // en eski (getBranches createdAt asc) — no yaşar

  const mergeMut = useMutation({
    mutationFn: (ids: string[]) => workOrderService.mergeBatches(ids),
    onSuccess: (res) => {
      toast.success(res.message ?? "Partiler birleştirildi");
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
    },
  });

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (batches.length === 0 && splitChildren.length === 0 && !splitFrom) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs italic text-muted-foreground">
        Bu iş emrinde henüz parti yok.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {splitFrom && <WorkOrderSplitFromNote splitFrom={splitFrom} />}

      {/* Birleştirme aksiyon çubuğu — 2+ sevksiz parti seçilince */}
      {selected.size >= 2 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs shadow-sm backdrop-blur">
          <GitMerge className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>{selected.size} parti</strong> seçili — hepsi en eski parti{" "}
            <span className="font-mono font-medium">{survivor?.batchNumber}</span> altında
            birleşecek.
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>
              Vazgeç
            </Button>
            <PermissionGate permission="workorder:write">
              <Button
                size="sm"
                className="h-7 gap-1 bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={mergeMut.isPending}
                onClick={() => setConfirmMerge(true)}
              >
                <GitMerge className="h-3.5 w-3.5" /> Birleştir
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}

      {batches.map((b, i) => (
        <BatchLaneCard
          key={b.batchId}
          batch={b}
          ordinal={i + 1}
          selectable={canSelect && !b.locked}
          selected={selected.has(b.batchId)}
          onToggleSelect={() => toggleSelect(b.batchId)}
          onCorrect={
            b.locked
              ? undefined
              : () => setCorrectTarget({ batchId: b.batchId, batchNumber: b.batchNumber })
          }
          onTebdil={(opts) =>
            setTebdilTarget({
              batchId: b.batchId,
              batchNumber: b.batchNumber,
              dispatchOnly: opts?.dispatchOnly,
            })
          }
          onDirectShip={(d) => setDirectShipTarget({ dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })}
          onUndoTransfer={(d) => setUndoTarget({ dispatchId: d.dispatchId, dispatchNo: d.dispatchNo })}
          onPrintDispatch={(d) => setPrintDispatchId(d.dispatchId)}
        />
      ))}
      {splitChildren.map((c) => (
        <WorkOrderSplitChildRow key={c.id} child={c} />
      ))}

      <TebdilWizard
        open={Boolean(tebdilTarget)}
        onOpenChange={(o) => !o && setTebdilTarget(null)}
        workOrderId={workOrderId}
        batchId={tebdilTarget?.batchId ?? ""}
        batchNumber={tebdilTarget?.batchNumber ?? ""}
        dispatchOnly={tebdilTarget?.dispatchOnly}
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
      <FasonSevkPrintDialog
        dispatchId={printDispatchId}
        open={Boolean(printDispatchId)}
        onOpenChange={(o) => !o && setPrintDispatchId(null)}
      />
      <BatchCorrectModal
        open={Boolean(correctTarget)}
        onOpenChange={(o) => !o && setCorrectTarget(null)}
        workOrderId={workOrderId}
        source={correctTarget}
        targets={batches
          .filter((b) => !b.locked && b.batchId !== correctTarget?.batchId)
          .map((b) => ({ batchId: b.batchId, batchNumber: b.batchNumber }))}
      />
      <ConfirmDialog
        open={confirmMerge}
        onOpenChange={setConfirmMerge}
        title="Partileri birleştir"
        description={`${selectedBatches.map((b) => b.batchNumber).join(", ")} → hepsi en eski parti ${survivor?.batchNumber ?? ""} altında tek partide birleşecek. İşlem geri alınamaz.`}
        confirmLabel="Birleştir"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          setConfirmMerge(false);
          mergeMut.mutate([...selected]);
        }}
      />
    </div>
  );
}

function BatchLaneCard({
  batch,
  ordinal,
  selectable,
  selected,
  onToggleSelect,
  onCorrect,
  onTebdil,
  onDirectShip,
  onUndoTransfer,
  onPrintDispatch,
}: {
  batch: BatchLane;
  ordinal: number;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** Sevksiz partide K8 düzeltme (top taşı / yeni partiye böl). Kilitliyse undefined. */
  onCorrect?: () => void;
  /** Tebdil sihirbazı — normal (ayır/yeniden boya) veya dispatchOnly (badge'den yalnız sevk). */
  onTebdil: (opts?: { dispatchOnly?: boolean }) => void;
  onDirectShip: (d: BatchLaneDispatch) => void;
  onUndoTransfer: (d: BatchLaneDispatch) => void;
  onPrintDispatch: (d: BatchLaneDispatch) => void;
}) {
  // Sevkler yeni → eski (son sevk üstte).
  const dispatches = [...batch.dispatches].sort((a, b) =>
    b.dispatchedAt.localeCompare(a.dispatchedAt),
  );
  return (
    <Card
      className={cn(
        "border-l-4 transition-colors",
        selected ? "border-l-primary ring-2 ring-primary/40" : "border-l-primary/40",
      )}
    >
      <CardContent className="space-y-2 p-3">
        {/* Başlık: (seç) + N. Parti + kod + kilit + tarih + Ayır */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
              title="Birleştirmek için seç"
              aria-label={`${batch.batchNumber} partisini birleştirmeye seç`}
            />
          )}
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
            {ordinal}. Parti
          </span>
          <span className="font-mono text-sm font-medium">{batch.batchNumber}</span>
          {batch.locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
              <Lock className="h-3 w-3" /> Sevkte
            </span>
          )}
          {batch.awaitingFasonDispatch && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
              title="Toplar fason adımında üretimde ama sevk edilmemiş — Fason Sevk ile boyahaneye gönderin"
            >
              <Truck className="h-3 w-3" /> Fasona sevk bekliyor
            </span>
          )}
          {batch.awaitingFasonDispatch && (
            <PermissionGate permission="workorder:write">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 border-amber-400/60 px-2 text-xs text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/30"
                onClick={() => onTebdil({ dispatchOnly: true })}
                title="Bu partiyi boyahaneye gönder (fason sevk + çeki)"
              >
                <Truck className="h-3.5 w-3.5" />
                Sevk Et
              </Button>
            </PermissionGate>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {safeFormat(batch.createdAt, "dd.MM.yyyy")}
          </span>
          {/* Düzelt (K8): sevksiz partide top taşı / yeni partiye böl (idari). */}
          {onCorrect && (
            <PermissionGate permission="workorder:write">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onCorrect}
                title="Top taşı / yeni partiye ayır (düzeltme)"
              >
                <Wrench className="h-3.5 w-3.5" />
                Düzelt
              </Button>
            </PermissionGate>
          )}
          {/* Tebdil / Yeniden Boyat: sihirbaz parti durumundan izinli modları türetir
              (aynı renk yeniden boya · farklı renk yeni İE · boyanmadan taşı). */}
          <PermissionGate permission="workorder:write">
            <Button
              size="sm"
              className="h-7 gap-1 border-transparent bg-indigo-600 px-2 text-xs text-white hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
              onClick={() => onTebdil()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tebdil / Yeniden Boyat
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

        {/* Fason sevkleri (K10: bir sevk = bir parti) — her biri belgeli, yeni → eski */}
        {dispatches.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            {dispatches.map((d) => (
              <BatchDispatchRow
                key={d.dispatchId}
                dispatch={d}
                onDirectShip={() => onDirectShip(d)}
                onUndoTransfer={() => onUndoTransfer(d)}
                onPrint={() => onPrintDispatch(d)}
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
  onPrint,
}: {
  dispatch: BatchLaneDispatch;
  onDirectShip: () => void;
  onUndoTransfer: () => void;
  onPrint: () => void;
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
      {/* Fason sevk irsaliyesi — bu partinin bu sevkinin belgesi (iptal hariç) */}
      {dispatch.status !== "CANCELLED" && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={onPrint}
          title="Fason sevk irsaliyesini yazdır"
        >
          <Printer className="h-3 w-3" />
          Belge
        </Button>
      )}
      {/* Doğrudan sevk: yalnız fasonda bekleyen (OPEN) sevkte. */}
      {dispatch.status === "OPEN" && (
        <PermissionGate permission="workorder:write">
          <Button
            size="sm"
            className="h-6 gap-1 border-transparent bg-emerald-600 px-2 text-[11px] text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
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
