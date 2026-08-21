import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  ArrowUpRight,
  Ban,
  ChevronDown,
  GitMerge,
  History,
  MoreHorizontal,
  MoveHorizontal,
  Printer,
  RefreshCw,
  Split,
  Truck,
  Undo2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { DirectShipmentDetailModal } from "@/pages/Operations/Shipments/DirectShipmentDetailModal";
import { UndoTransferModal } from "./UndoTransferModal";
import { FasonSevkPrintDialog } from "./FasonSevkPrintDialog";
import { FasonStepRollSelectModal } from "./FasonStepRollSelectModal";
import { BatchCorrectModal } from "./BatchCorrectModal";
import { BatchDropDialog } from "./BatchDropDialog";
import { ManualMoveModal } from "./ManualMoveModal";
import { BatchTimeline, stripFason } from "./BatchTimeline";
import { findBatchTransferContext, type BatchTransferContext } from "./batch-transfer";
import { buildMergeConfirmDescription } from "./batch-merge-confirm";
import { Wrench } from "lucide-react";
import type { BatchLaneRoll } from "./service";
import type { WorkOrderStepLite } from "./types";

const STATUS_META: Record<BatchDispatchStatus, { label: string; cls: string }> = {
  OPEN: { label: "Fasonda", cls: "border-warning/40 bg-warning/10 text-warning" },
  PARTIAL: { label: "Kısmi dönüş", cls: "border-primary/40 bg-primary/10 text-primary" },
  RETURNED: { label: "Döndü", cls: "border-success/40 bg-success/10 text-success" },
  CANCELLED: { label: "İptal", cls: "border-border bg-muted text-muted-foreground" },
  DIRECT_SHIPPED: { label: "Fasondan Sevk", cls: "border-primary/40 bg-primary/10 text-primary" },
};

/**
 * Parti lane'leri (Partiler paneli). Her lane = BAĞIMSIZ bir Batch (parti):
 * "N. Parti" başlığı + belirgin ayrım. Üye topların konumu, fason sevkleri (K10),
 * her sevkin belgesi (irsaliye) ve soy bağı görünür. Dolu partiler çoklu seçilip
 * BİRLEŞTİRİLEBİLİR (K8+K15, en eski no yaşar; açık sevkler survivor'a taşınır).
 * Refakat kartı iş emri başına olduğundan lane'de tekrarlanmaz (başlıkta bir kez).
 * Kilit türetilmiş (K14: mal fiilen dışarıda) — araçları artık KAPATMAZ, yalnız rozet.
 */
export function BranchLanes({
  workOrderId,
  steps,
}: {
  workOrderId: string;
  /** WO rotası (getById'den) — parti menüsündeki "Sonraki Fasona Aktar" gating'i
   *  için (partinin fasondaki topları + sıradaki adım fason mu). Verilmezse madde
   *  hiç görünmez. */
  steps?: WorkOrderStepLite[];
}) {
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
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [correctTarget, setCorrectTarget] = useState<{
    batchId: string;
    batchNumber: string;
    locked: boolean;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    batchId: string;
    batchNumber: string;
    rolls: BatchLaneRoll[];
  } | null>(null);
  // Parti menüsünden "Sonraki Fasona Aktar" — kaynak adım + parti topları + hedef.
  const [transferTarget, setTransferTarget] = useState<
    (BatchTransferContext & { batchNumber: string }) | null
  >(null);

  const batches = q.data?.data?.batches ?? [];
  const splitFrom = q.data?.data?.splitFrom ?? null;
  const splitChildren = q.data?.data?.splitChildren ?? [];
  // Boş (top kalmamış) partiler fason izi olduğu için silinmeyip kalır ama anlık
  // görünümde işlevsizdir → varsayılan GİZLİ, toggle ile açılır. (Gantt onları zaten
  // göstermez; anlık konumları yok.)
  const filledBatches = batches.filter((b) => b.rollCount > 0);
  const emptyBatches = batches.filter((b) => b.rollCount === 0);
  const [showEmpty, setShowEmpty] = useState(false);

  // K8+K15 birleştirme: kilit artık engel değil (açık sevkler survivor'a taşınır/birleşir,
  // backend farklı-firma çakışmasını 409'lar) — ≥2 DOLU parti varsa seçim açık.
  const canSelect = filledBatches.length >= 2;
  // Bayat seçim budaması: eşzamanlı işlemle boşalan/birleşen parti seçimde takılı
  // kalmasın (checkbox'ı kaybolduğundan tek tek kaldırılamaz hale geliyordu).
  const validSelectable = useMemo(
    () => new Set(filledBatches.map((b) => b.batchId)),
    [filledBatches],
  );
  const prunedSelected = useMemo(
    () => new Set([...selected].filter((id) => validSelectable.has(id))),
    [selected, validSelectable],
  );
  const selectedBatches = batches.filter((b) => prunedSelected.has(b.batchId));
  const survivor = selectedBatches[0]; // en eski (getBranches createdAt+id asc) — no yaşar

  const mergeMut = useMutation({
    mutationFn: (ids: string[]) => workOrderService.mergeBatches(ids),
    onSuccess: (res) => {
      toast.success(res.message ?? "Partiler birleştirildi");
      setSelected(new Set());
    },
    // onSettled: 409'da da lane'i tazele — çakışmaya yol açan bayat görünüm
    // (başka kullanıcının yeni sevki/birleştirmesi) ekranda kalmasın; kullanıcı
    // çakışan partiyi görerek seçimden çıkarabilsin (seçim bilinçli resetlenmez).
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      // Liste de tazelenir (transferMut ile simetri): birleştirme parti sayısını
      // düşürür ve WO satırındaki türetilmiş alanları oynatır. onSettled'da
      // kalması bilinçli — 409'da da liste tazelenir.
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  const transferMut = useMutation({
    mutationFn: (vars: { stepId: string; rollIds: string[] }) =>
      workOrderService.transferToNextFason({
        workOrderId,
        stepId: vars.stepId,
        rollIds: vars.rollIds,
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Sonraki fasona aktarıldı.");
      setTransferTarget(null);
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
    },
  });

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const renderLane = (b: BatchLane, ordinal: number, selectable: boolean) => (
    <BatchLaneCard
      key={b.batchId}
      batch={b}
      workOrderId={workOrderId}
      steps={steps}
      ordinal={ordinal}
      selectable={selectable}
      selected={prunedSelected.has(b.batchId)}
      onToggleSelect={() => toggleSelect(b.batchId)}
      onTransferFason={(ctx) => setTransferTarget({ ...ctx, batchNumber: b.batchNumber })}
      onCorrect={() =>
        setCorrectTarget({ batchId: b.batchId, batchNumber: b.batchNumber, locked: b.locked })
      }
      onDrop={() => setDropTarget(b.batchId)}
      onManualMove={() =>
        setMoveTarget({ batchId: b.batchId, batchNumber: b.batchNumber, rolls: b.rolls ?? [] })
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
  );

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

      {/* Birleştirme aksiyon çubuğu — 2+ parti seçilince (K15: kilitliler dahil) */}
      {prunedSelected.size >= 2 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-xs shadow-sm backdrop-blur">
          <GitMerge className="h-4 w-4 shrink-0 text-primary" />
          <span>
            <strong>{prunedSelected.size} parti</strong> seçili — hepsi en eski parti{" "}
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

      {filledBatches.map((b, i) => renderLane(b, i + 1, canSelect))}

      {/* Boş partiler — varsayılan gizli, top kalmadığı için anlık görünümde işlevsiz.
          Geçmişleri kendi "Geçmiş & Sevkler" butonlarında erişilebilir kalır. */}
      {emptyBatches.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowEmpty((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showEmpty && "rotate-180")}
            />
            {showEmpty
              ? "Boş partileri gizle"
              : `${emptyBatches.length} boş parti (top kalmadı) — göster`}
          </button>
        </div>
      )}
      {showEmpty && emptyBatches.map((b, i) => renderLane(b, filledBatches.length + i + 1, false))}

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
        sourceLocked={correctTarget?.locked ?? false}
        targets={batches
          // K14: kilitli parti de hedef olabilir (backend farklı-firma çakışmasını
          // 409'lar) — ama birleşip kapanmış (mergedInto) tarihçe satırları olamaz.
          .filter((b) => !b.mergedInto && b.batchId !== correctTarget?.batchId)
          .map((b) => ({ batchId: b.batchId, batchNumber: b.batchNumber }))}
      />
      <ManualMoveModal
        open={Boolean(moveTarget)}
        onOpenChange={(o) => !o && setMoveTarget(null)}
        workOrderId={workOrderId}
        source={moveTarget}
      />
      <BatchDropDialog
        open={Boolean(dropTarget)}
        onOpenChange={(o) => !o && setDropTarget(null)}
        workOrderId={workOrderId}
        batchId={dropTarget}
      />
      {transferTarget && (
        <FasonStepRollSelectModal
          open={Boolean(transferTarget)}
          onOpenChange={(o) => !o && setTransferTarget(null)}
          title={`${transferTarget.batchNumber} → ${stripFason(transferTarget.nextStationName)} Aktarımı`}
          mode="transfer"
          rolls={transferTarget.rolls}
          destinationName={stripFason(transferTarget.nextStationName)}
          confirmLabel="Aktar"
          isPending={transferMut.isPending}
          onConfirm={(ids) =>
            transferMut.mutate({ stepId: transferTarget.stepId, rollIds: ids })
          }
        />
      )}
      <ConfirmDialog
        open={confirmMerge}
        onOpenChange={setConfirmMerge}
        title="Partileri birleştir"
        description={buildMergeConfirmDescription(selectedBatches)}
        confirmLabel="Birleştir"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          setConfirmMerge(false);
          mergeMut.mutate([...prunedSelected]);
        }}
      />
    </div>
  );
}

function BatchLaneCard({
  batch,
  workOrderId,
  steps,
  ordinal,
  selectable,
  selected,
  onToggleSelect,
  onCorrect,
  onDrop,
  onManualMove,
  onTebdil,
  onDirectShip,
  onUndoTransfer,
  onPrintDispatch,
  onTransferFason,
}: {
  batch: BatchLane;
  workOrderId: string;
  steps?: WorkOrderStepLite[];
  ordinal: number;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  /** K8 düzeltme (top taşı / yeni partiye böl) — K14: kilitli partide de açık
   *  (K16 sevk kalemini böler/taşır). Birleşmiş lane'de menü zaten gizli. */
  onCorrect: () => void;
  /** Partiyi iş emrinden düşür — iş emri diğer partileriyle devam eder. */
  onDrop: () => void;
  /** Süpervizör "Konumu Düzelt" — rotada ileri/geri manuel taşıma (parti/top bazında). */
  onManualMove: () => void;
  /** Tebdil sihirbazı — normal (ayır/yeniden boya) veya dispatchOnly (badge'den yalnız sevk). */
  onTebdil: (opts?: { dispatchOnly?: boolean }) => void;
  onDirectShip: (d: BatchLaneDispatch) => void;
  onUndoTransfer: (d: BatchLaneDispatch) => void;
  onPrintDispatch: (d: BatchLaneDispatch) => void;
  /** Partinin fasondaki toplarını sıradaki fason adıma aktar (top seçim modalı açılır). */
  onTransferFason: (ctx: BatchTransferContext) => void;
}) {
  // Sevkler yeni → eski (Geçmiş modalında + ⋯ menü maddelerinde kullanılır).
  const dispatches = [...batch.dispatches].sort((a, b) =>
    b.dispatchedAt.localeCompare(a.dispatchedAt),
  );
  // Mal ŞU AN fasonda mı = herhangi bir top FİZİKSEL olarak fasonda (AT_SUBCONTRACTOR).
  // "Konum" sütunuyla AYNI kaynaktan (topların gerçek statüsü) türetilir → pil ile konum
  // asla çelişmez. NOT: `batch.locked` (K14) buna outstanding açık sevki de ekler
  // (zombi-sevk kilidi) — "konum" rozeti için top statüsü daha doğru kaynak.
  const atFason = batch.rolls.some((r) => r.status === "AT_SUBCONTRACTOR");
  // "Sonraki Fasona Aktar" bağlamı — partinin fasondaki topları + sıradaki adım
  // fason ise dolu (batch-transfer.ts; FasonStepActions gating'iyle birebir).
  const transferCtx = useMemo(
    () => findBatchTransferContext(steps, batch.batchNumber),
    [steps, batch.batchNumber],
  );
  // Parti varsayılan KATLI (accordion) — başlıkta özet; açınca toplar + Geçmiş.
  const [expanded, setExpanded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Accordion başlığındaki konum özeti — "mal nerede" tek bakışta.
  const positionText =
    batch.currentPositions.length > 0
      ? batch.currentPositions.map((p) => `${p.label}: ${p.count} top`).join(" · ")
      : `${batch.rollCount} top`;
  return (
    <Card
      className={cn(
        "border-border/50 shadow-sm transition-colors",
        selected && "ring-2 ring-primary/30",
      )}
    >
      <CardContent className="space-y-2 p-3">
        {/* Başlık = accordion tetik (parti + durum + konum özeti) + tarih + ⋯ menüsü */}
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={expanded}
            title={expanded ? "Partiyi kapat" : "Parti detayını aç"}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
            <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
              {ordinal}. Parti
            </span>
            <span className="shrink-0 font-mono text-sm font-medium">{batch.batchNumber}</span>
            {batch.mergedInto && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                title="Bu parti birleştirmeyle kapandı — topları ve sevkleri hedef partide (K17 tarihçe satırı)"
              >
                <GitMerge className="h-3 w-3" /> → {batch.mergedInto.batchNumber} altına birleşti
              </span>
            )}
            {atFason && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                title="Mal şu an bir fason firmasında (henüz dönmedi)"
              >
                <Truck className="h-3 w-3" /> Fasonda
              </span>
            )}
            {batch.awaitingFasonDispatch && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
                title="Toplar fason adımında üretimde ama sevk edilmemiş"
              >
                <Truck className="h-3 w-3" /> Fasona sevk bekliyor
              </span>
            )}
            {/* Konum özeti — kapalıyken mal nerede tek bakışta */}
            <span className="min-w-0 truncate text-xs text-muted-foreground">· {positionText}</span>
          </button>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {safeFormat(batch.createdAt, "dd.MM.yyyy · HH:mm")}
          </span>
          {/* Parti aksiyonları — tek ⋯ menüsü. Menü HERKESE açık (Geçmiş + Belge
              salt-okur işler); yazma gerektiren maddeler tek tek PermissionGate'li. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 shrink-0 p-0"
                title="Parti işlemleri"
                aria-label="Parti işlemleri"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Sevk-bazlı aksiyonlar (İrsaliye / Fasondan Sevk / Aktarımı Geri Al) artık
                  Geçmiş & Sevkler tablosunda SATIR ⋯'ında — bakiye bağlamının yanında. */}
              <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                <History className="mr-2 h-4 w-4" /> Geçmiş & Sevkler
                {dispatches.length > 0 ? ` (${dispatches.length})` : ""}
              </DropdownMenuItem>
              {/* Birleşmiş kaynak parti (K17) salt tarihçe satırıdır — yazma
                  aksiyonları gizli; Geçmiş & Sevkler (+ içindeki belgeler) kalır. */}
              {!batch.mergedInto && (
                <PermissionGate permission="workorder:write">
                  <DropdownMenuSeparator />
                  {batch.awaitingFasonDispatch && (
                    <DropdownMenuItem onClick={() => onTebdil({ dispatchOnly: true })}>
                      <Truck className="mr-2 h-4 w-4" /> Fasona Sevk Et
                    </DropdownMenuItem>
                  )}
                  {transferCtx && (
                    <DropdownMenuItem
                      disabled={!transferCtx.nextPlanned}
                      title={
                        transferCtx.nextPlanned ? undefined : "Sonraki fason firması planlanmamış."
                      }
                      onClick={() => onTransferFason(transferCtx)}
                    >
                      <ArrowRightLeft className="mr-2 h-4 w-4" /> Sonraki Fasona Aktar →{" "}
                      {stripFason(transferCtx.nextStationName)}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={onManualMove}>
                    <MoveHorizontal className="mr-2 h-4 w-4" /> Konumu Düzelt
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onTebdil()}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Tebdil / Yeniden Boyat
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onCorrect}>
                    <Wrench className="mr-2 h-4 w-4" /> Düzelt (top taşı / ayır)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={onDrop}>
                    <Ban className="mr-2 h-4 w-4" /> Partiyi Düşür
                  </DropdownMenuItem>
                </PermissionGate>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {expanded && (
          <>
        {/* Partinin topları — barkod · kumaş · renk · konum · metraj (açınca doğrudan). */}
        {batch.rolls.length > 0 ? (
          <div className="overflow-x-auto rounded-md border border-border/40">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/30 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Barkod</th>
                  <th className="px-2 py-1 font-medium">Kumaş</th>
                  <th className="px-2 py-1 font-medium">Renk</th>
                  <th className="px-2 py-1 font-medium">Konum</th>
                  <th className="px-2 py-1 text-right font-medium">Metraj</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {batch.rolls.map((r) => (
                  <tr key={r.id}>
                    <td className="px-2 py-1 font-mono">
                      {r.barcode ?? (
                        <span className="italic text-muted-foreground">Açık kumaş</span>
                      )}
                    </td>
                    <td className="px-2 py-1 font-medium">{r.item?.name ?? "—"}</td>
                    <td className="px-2 py-1">
                      {r.color ? (
                        <span className="inline-flex items-center gap-1">
                          {r.color.hex && (
                            <span
                              className="h-2 w-2 rounded-full border border-black/10"
                              style={{ backgroundColor: r.color.hex }}
                            />
                          )}
                          {r.color.name}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        {r.positionLabel}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right font-medium tabular-nums">
                      {formatNumber(r.currentQty, 0)} m
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-2 text-center text-[11px] italic text-muted-foreground">
            Bu partide top yok.
          </div>
        )}

          </>
        )}

        <BatchHistoryModal
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          batch={batch}
          workOrderId={workOrderId}
          onPrintDispatch={onPrintDispatch}
          onDirectShip={onDirectShip}
          onUndoTransfer={onUndoTransfer}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Parti geçmişi modalı — "geçmiş/denetim" detayı lane'den ayrı: refakat kartı,
 * soy bağı (redye split) ve TÜM fason sevkler (aktif + tamamlanan + iptal) tek
 * yerde. Belge / Fasondan Sevk parti ⋯ menüsüne taşındı — modalda kalan tek
 * aksiyon (nadir) "Aktarımı Geri Al".
 */
function BatchHistoryModal({
  open,
  onOpenChange,
  batch,
  workOrderId,
  onPrintDispatch,
  onDirectShip,
  onUndoTransfer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  batch: BatchLane;
  workOrderId: string;
  onPrintDispatch: (d: BatchLaneDispatch) => void;
  onDirectShip: (d: BatchLaneDispatch) => void;
  onUndoTransfer: (d: BatchLaneDispatch) => void;
}) {
  const dispatches = [...batch.dispatches].sort((a, b) =>
    b.dispatchedAt.localeCompare(a.dispatchedAt),
  );
  // İptal (superseded) sevk denemeleri varsayılan GİZLİ — geçmişte gürültü yapar.
  const activeDispatches = dispatches.filter((d) => d.status !== "CANCELLED");
  const cancelledDispatches = dispatches.filter((d) => d.status === "CANCELLED");
  const [showCancelled, setShowCancelled] = useState(false);
  const directShipments = batch.directShipments ?? [];
  // Fasondan sevk satırına tıklayınca açılan detay modalı.
  const [dsDetailId, setDsDetailId] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          {/* Refakat kartı başlıkla AYNI satırda, sağda (pr-6: kapat ✕ ile çakışmasın). */}
          <div className="flex items-baseline justify-between gap-4 pr-6">
            <DialogTitle>
              Parti Geçmişi — <span className="font-mono">{batch.batchNumber}</span>
            </DialogTitle>
            {batch.cardNumber && (
              <span className="shrink-0 text-xs text-muted-foreground">
                Refakat Kartı:{" "}
                <span className="font-mono text-foreground">{batch.cardNumber}</span>
              </span>
            )}
          </div>
        </DialogHeader>
        <div className="max-h-[78vh] space-y-4 overflow-auto pr-1">
          {(batch.splitFrom || batch.splitChildren.length > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
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
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rota Geçmişi
            </div>
            <BatchTimeline workOrderId={workOrderId} batchId={batch.batchId} enabled={open} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fason Sevkler ({dispatches.length})
            </div>
            {dispatches.length > 0 ? (
              <div className="overflow-x-auto rounded-md border border-border/40">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/30 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 font-medium">Sevk No</th>
                      <th className="px-2 py-1 font-medium">Durum</th>
                      <th className="px-2 py-1 font-medium">Hedef</th>
                      <th className="px-2 py-1 text-right font-medium">Miktar</th>
                      <th className="px-2 py-1 font-medium">Tarih</th>
                      <th className="px-2 py-1 font-medium">Kapanış</th>
                      <th className="w-8 px-2 py-1" aria-label="İşlem" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {activeDispatches.map((d) => (
                      <DispatchRow
                        key={d.dispatchId}
                        dispatch={d}
                        onPrint={() => onPrintDispatch(d)}
                        onDirectShip={() => onDirectShip(d)}
                        onUndoTransfer={() => onUndoTransfer(d)}
                      />
                    ))}
                    {cancelledDispatches.length > 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => setShowCancelled((v) => !v)}
                            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            <ChevronDown
                              className={cn("h-3 w-3 transition-transform", showCancelled && "rotate-180")}
                            />
                            {showCancelled
                              ? "İptal edilen denemeleri gizle"
                              : `${cancelledDispatches.length} iptal edilmiş sevk denemesi`}
                          </button>
                        </td>
                      </tr>
                    )}
                    {showCancelled &&
                      cancelledDispatches.map((d) => (
                        <DispatchRow
                          key={d.dispatchId}
                          dispatch={d}
                          onPrint={() => onPrintDispatch(d)}
                          onDirectShip={() => onDirectShip(d)}
                          onUndoTransfer={() => onUndoTransfer(d)}
                        />
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-[11px] italic text-muted-foreground">
                Bu partide fason sevk yok.
              </div>
            )}
          </div>

          {/* Fasondan sevkler (DSK) — mal fasondan doğrudan müşteriye gitti. Satıra
              tıkla → detay modalı (müşteri/toplar/karşılanan sipariş + İrsaliye). */}
          {directShipments.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fasondan Sevkler ({directShipments.length})
              </div>
              <div className="overflow-x-auto rounded-md border border-border/40">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/30 text-left text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 font-medium">Sevk No</th>
                      <th className="px-2 py-1 font-medium">Müşteri</th>
                      <th className="px-2 py-1 text-right font-medium">Miktar</th>
                      <th className="px-2 py-1 font-medium">Tarih</th>
                      <th className="w-6 px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {directShipments.map((ds) => (
                      <tr
                        key={ds.id}
                        onClick={() => setDsDetailId(ds.id)}
                        className="cursor-pointer hover:bg-muted/30"
                      >
                        <td className="px-2 py-1 font-mono">{ds.shipmentNo}</td>
                        <td className="px-2 py-1">{ds.customerName ?? "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {formatNumber(ds.totalQty, 0)} m · {ds.rollCount} top
                        </td>
                        <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">
                          {safeFormat(ds.shippedAt, "dd.MM.yyyy · HH:mm")}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-primary" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DirectShipmentDetailModal
          directShipmentId={dsDetailId}
          open={Boolean(dsDetailId)}
          onOpenChange={(o) => !o && setDsDetailId(null)}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Geçmiş modalında bir fason sevk satırı (mutabakat tablosu). Sevk-bazlı aksiyonlar
 *  (İrsaliye / Fasondan Sevk / Aktarımı Geri Al) SATIR ⋯'ında — bakiye bağlamının yanında. */
function DispatchRow({
  dispatch,
  onPrint,
  onDirectShip,
  onUndoTransfer,
}: {
  dispatch: BatchLaneDispatch;
  onPrint: () => void;
  onDirectShip: () => void;
  onUndoTransfer: () => void;
}) {
  const meta = STATUS_META[dispatch.status];
  const cancelled = dispatch.status === "CANCELLED";
  const isOpen = dispatch.status === "OPEN";
  const atFason = Math.max(0, dispatch.totalQty - dispatch.returnedQty - dispatch.directShippedQty);
  return (
    <tr className={cn(cancelled && "opacity-60")}>
      <td className="whitespace-nowrap px-2 py-1 font-mono">{dispatch.dispatchNo}</td>
      <td className="px-2 py-1">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.cls)}>
          {meta.label}
        </span>
      </td>
      <td className="px-2 py-1">
        <span className="block whitespace-nowrap font-medium text-foreground">
          {dispatch.subcontractorName}
        </span>
        {dispatch.stepName && (
          <span className="block whitespace-nowrap text-[10px] text-muted-foreground">
            {stripFason(dispatch.stepName)} adımı
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
        {dispatch.rollCount} parça · {formatNumber(dispatch.totalQty, 0)} m
      </td>
      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
        {safeFormat(dispatch.dispatchedAt, "dd.MM.yyyy · HH:mm")}
      </td>
      <td className="px-2 py-1">
        <KapanisCell dispatch={dispatch} />
      </td>
      <td className="px-2 py-1 text-right">
        {/* Sevk-bazlı aksiyonlar — tek tip ⋯ (asla çıplak '—'); İrsaliye her zaman,
            Fasondan Sevk & Aktarımı Geri Al koşullu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Sevk işlemleri">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onPrint}>
              <Printer className="mr-2 h-4 w-4" /> İrsaliye Yazdır
            </DropdownMenuItem>
            <PermissionGate permission="workorder:write">
              {isOpen && atFason > 0 && (
                <DropdownMenuItem onClick={onDirectShip}>
                  <Truck className="mr-2 h-4 w-4" /> Fasondan Sevk
                </DropdownMenuItem>
              )}
              {isOpen && dispatch.isTransferOutput && (
                <DropdownMenuItem onClick={onUndoTransfer}>
                  <Undo2 className="mr-2 h-4 w-4" /> Aktarımı Geri Al
                </DropdownMenuItem>
              )}
            </PermissionGate>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/** Kapanış hücresi — sevkin akıbeti METRAJ bakiyesi olarak: Dönen · Fasondan · Fasonda
 *  kalan. Yığılı bar (yeşil/amber/gri) + öne çıkan kalan; tam kapandıysa "✓ Kapandı",
 *  hiç dokunulmadıysa "Fasonda D m". "Gönderdiğimin ne kadarı hâlâ dışarıda?" tek bakışta. */
function KapanisCell({ dispatch }: { dispatch: BatchLaneDispatch }) {
  const D = dispatch.totalQty;
  const X = dispatch.returnedQty; // dönen
  const Y = dispatch.directShippedQty; // fasondan sevk
  const Z = Math.max(0, D - X - Y); // fasonda kalan
  if (dispatch.status === "CANCELLED" || D <= 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  const title = `Sevk ${formatNumber(D, 0)} m · Dönen ${formatNumber(X, 0)} · Fasondan ${formatNumber(Y, 0)} · Fasonda ${formatNumber(Z, 0)}`;
  if (Z === 0) {
    return (
      <span
        title={title}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success"
      >
        ✓ Kapandı
      </span>
    );
  }
  if (X === 0 && Y === 0) {
    return (
      <span title={title} className="whitespace-nowrap text-[10px] text-muted-foreground">
        Fasonda {formatNumber(D, 0)} m
      </span>
    );
  }
  const pct = (v: number) => `${(v / D) * 100}%`;
  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
        {X > 0 && <div className="bg-success" style={{ width: pct(X) }} />}
        {Y > 0 && <div className="bg-amber-500" style={{ width: pct(Y) }} />}
        {Z > 0 && <div className="bg-muted-foreground/25" style={{ width: pct(Z) }} />}
      </div>
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
        kalan {formatNumber(Z, 0)} m
      </span>
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
