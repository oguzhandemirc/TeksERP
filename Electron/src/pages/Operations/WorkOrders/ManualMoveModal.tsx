import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft, Ban, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workOrderService, type BatchLaneRoll, type ManualMovePartyMode } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  /** Kaynak parti + toplar (BranchLanes'ten geçer — seçim buradan sunulur). */
  source: { batchId: string; batchNumber: string; rolls: BatchLaneRoll[] } | null;
}

/**
 * Süpervizör "Konumu Düzelt" — parti/top rotada İLERİ veya GERİ manuel taşınır
 * (Kurşun↔Tambur gibi), DB'ye elle müdahale yerine. Kısmi seçimde parti kararı
 * (yeni parti / hedef partiye kat) sorulur. Gerekçe zorunlu; önizleme taşınamaz
 * topları ve uyarıları gösterir. Backend: /manual-move(-preview).
 */
export function ManualMoveModal({ open, onOpenChange, workOrderId, source }: Props) {
  const qc = useQueryClient();
  const [targetStepId, setTargetStepId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partyMode, setPartyMode] = useState<ManualMovePartyMode>("new");
  const [joinBatchId, setJoinBatchId] = useState("");
  const [reason, setReason] = useState("");

  // Rota adımları (detay cache'inden — hedef seçici için).
  const woQ = useQuery({
    queryKey: ["work-order-detail", workOrderId],
    queryFn: () => workOrderService.getById(workOrderId),
    enabled: open && Boolean(workOrderId),
    staleTime: 60_000,
  });
  const steps = woQ.data?.data?.steps ?? [];

  useEffect(() => {
    if (open && source) {
      setTargetStepId("");
      setSelected(new Set(source.rolls.map((r) => r.id)));
      setPartyMode("new");
      setJoinBatchId("");
      setReason("");
    }
  }, [open, source]);

  const selectedIds = useMemo(() => [...selected].sort(), [selected]);
  const allSelected = Boolean(source) && selected.size === source!.rolls.length && selected.size > 0;
  const selectionPayload = allSelected
    ? { batchId: source!.batchId }
    : { rollIds: selectedIds };

  const previewQ = useQuery({
    queryKey: ["manual-move-preview", workOrderId, targetStepId, allSelected, selectedIds.join(",")],
    queryFn: () => workOrderService.getManualMovePreview(workOrderId, { ...selectionPayload, targetStepId }),
    enabled: open && Boolean(targetStepId) && selected.size > 0,
    staleTime: 0,
  });
  const preview = previewQ.data?.data ?? null;
  const blockById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of preview?.rolls ?? []) m.set(r.id, r.movable ? null : r.blockReason);
    return m;
  }, [preview]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
  };

  const moveMut = useMutation({
    mutationFn: () =>
      workOrderService.manualMove(workOrderId, {
        ...selectionPayload,
        targetStepId,
        ...(preview?.partyDecisionNeeded
          ? { partyMode, ...(partyMode === "join" ? { joinBatchId } : {}) }
          : {}),
        reason: reason.trim(),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Toplar taşındı");
      invalidate();
      onOpenChange(false);
    },
  });
  const pending = moveMut.isPending;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const needParty = preview?.partyDecisionNeeded ?? false;
  const joinCandidates = preview?.candidateJoinParties ?? [];
  const blockedInSelection = (preview?.blockedCount ?? 0) > 0;
  const canSubmit =
    !pending &&
    Boolean(targetStepId) &&
    selected.size > 0 &&
    preview !== null &&
    !blockedInSelection &&
    reason.trim().length >= 3 &&
    (!needParty || partyMode !== "join" || Boolean(joinBatchId));

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
  };

  const selectedMeters = (source?.rolls ?? [])
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + r.currentQty, 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Konumu Düzelt — {source?.batchNumber}
          </DialogTitle>
          <DialogDescription>
            Partiyi/topları rotada ileri veya geri taşı (ör. Kurşun↔Tambur). Bu bir
            düzeltmedir; gerekçe zorunlu.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* Hedef adım */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Hedef adım
            </label>
            <select
              value={targetStepId}
              onChange={(e) => setTargetStepId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— adım seç —</option>
              {steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.stepSequence}. {s.station?.name ?? "Adım"}
                  {s.station?.type === "EXTERNAL" ? " (Fason)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Top seçimi */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Toplar ({selected.size}/{source?.rolls.length ?? 0})
              </span>
              {(source?.rolls.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary hover:underline"
                  onClick={() =>
                    setSelected(
                      allSelected ? new Set() : new Set(source!.rolls.map((r) => r.id)),
                    )
                  }
                >
                  {allSelected ? "Hiçbirini" : "Tümünü seç"}
                </button>
              )}
            </div>
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
              {(source?.rolls ?? []).map((r) => {
                const on = selected.has(r.id);
                const block = on ? blockById.get(r.id) : null;
                return (
                  <li key={r.id} className={cn("rounded px-1 py-0.5 text-xs", !on && "opacity-50")}>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={on} onCheckedChange={() => toggle(r.id)} />
                      <span className="flex-1 truncate font-mono">
                        {r.barcode ?? <span className="italic text-muted-foreground">Açık kumaş</span>}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        {r.positionLabel}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatNumber(r.currentQty, 0)} m
                      </span>
                    </div>
                    {block && (
                      <div className="mt-0.5 flex items-center gap-1 pl-6 text-[11px] text-destructive">
                        <Ban className="h-3 w-3 shrink-0" /> {block}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {selected.size > 0 && (
              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                Seçili: {formatNumber(selectedMeters, 0)} m
              </div>
            )}
          </div>

          {/* Parti kararı (yalnız kısmi taşımada) */}
          {needParty && (
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                Kısmi taşıma — taşınan toplar hangi partide olsun?
              </div>
              <div className="grid grid-cols-2 gap-2">
                <PartyModeButton
                  active={partyMode === "new"}
                  label="Yeni parti"
                  onClick={() => setPartyMode("new")}
                />
                <PartyModeButton
                  active={partyMode === "join"}
                  label="Var olan partiye kat"
                  disabled={joinCandidates.length === 0}
                  onClick={() => setPartyMode("join")}
                />
              </div>
              {partyMode === "join" && (
                <select
                  value={joinBatchId}
                  onChange={(e) => setJoinBatchId(e.target.value)}
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">— parti seç —</option>
                  {joinCandidates.map((p) => (
                    <option key={p.batchId} value={p.batchId}>
                      {p.batchNumber}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Uyarılar */}
          {previewQ.isFetching && !preview && <Skeleton className="h-10 w-full" />}
          {(preview?.warnings.length ?? 0) > 0 && (
            <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-2.5">
              {preview!.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-warning">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}
          {blockedInSelection && (
            <div className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
              <Ban className="h-3.5 w-3.5 shrink-0" />
              Seçili topların bazıları bu hedefe taşınamaz — işaretini kaldırın veya hedefi
              değiştirin.
            </div>
          )}

          {/* Gerekçe */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Gerekçe <span className="text-destructive">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Örn. Kurşun'da yanlış okutuldu, Tambur'a alındı."
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Info className="h-3 w-3" /> Audit'e yazılır (en az 3 karakter).
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={() => moveMut.mutate()}>
            {pending ? "Taşınıyor..." : `Taşı (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartyModeButton({
  active,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        active ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50",
      )}
    >
      {label}
    </button>
  );
}
