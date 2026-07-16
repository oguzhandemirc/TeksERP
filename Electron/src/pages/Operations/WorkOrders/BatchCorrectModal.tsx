import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Scissors } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { workOrderService } from "./service";

type Mode = "split" | "move";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  /** Kaynak parti. */
  source: { batchId: string; batchNumber: string } | null;
  /** Kaynak parti kilitli (malı fasonda / açık sevkli) — K16 sevk cerrahisi notu gösterilir. */
  sourceLocked?: boolean;
  /** Taşıma hedefi olabilecek diğer partiler (kaynak ve birleşmiş tarihçe satırları hariç). */
  targets: { batchId: string; batchNumber: string }[];
}

/**
 * K8 süpervizör düzeltme — partiden seçili topları:
 *  • Yeni partiye AYIR (splitBatch, redye DEĞİL — saf idari bölme; TÜM toplar seçilemez), veya
 *  • Başka partiye TAŞI (moveRolls).
 * K14 ile kilitli (fasonda) partide de çalışır — açık sevk kalemleri hedefe
 * taşınır/bölünür (K16); aynı adımda farklı firma çakışmasını backend 409'lar.
 * Redye "Ayır"dan ayrıdır (o üretim aksiyonu; bu düzeltme). Toplar getSplitPreview'den.
 */
export function BatchCorrectModal({
  open,
  onOpenChange,
  workOrderId,
  source,
  sourceLocked,
  targets,
}: Props) {
  const qc = useQueryClient();
  const batchId = source?.batchId ?? "";
  const [mode, setMode] = useState<Mode>("split");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toBatchId, setToBatchId] = useState<string>("");

  const previewQ = useQuery({
    queryKey: ["batch-split-preview", workOrderId, batchId],
    queryFn: () => workOrderService.getSplitPreview(workOrderId, batchId),
    enabled: open && Boolean(batchId),
    staleTime: 0,
  });
  const rolls = previewQ.data?.data?.rolls ?? [];

  useEffect(() => {
    if (open) {
      setMode(targets.length > 0 ? "move" : "split");
      setSelected(new Set());
      setToBatchId(targets[0]?.batchId ?? "");
    }
  }, [open, batchId, targets.length]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
    void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
  };

  const moveMut = useMutation({
    mutationFn: () => workOrderService.moveRolls([...selected], toBatchId),
    onSuccess: (res) => {
      toast.success(`${res.data?.movedCount ?? selected.size} top ${res.data?.toBatchNumber ?? ""} partisine taşındı`);
      invalidate();
      onOpenChange(false);
    },
  });
  const splitMut = useMutation({
    mutationFn: () => workOrderService.splitBatchRolls(batchId, [...selected]),
    onSuccess: (res) => {
      toast.success(`Yeni parti oluşturuldu: ${res.data?.newBatchNumber ?? ""} (${selected.size} top)`);
      invalidate();
      onOpenChange(false);
    },
  });
  const pending = moveMut.isPending || splitMut.isPending;

  const total = rolls.length;
  const allSelected = total > 0 && selected.size === total;
  const totalMeters = useMemo(
    () => rolls.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.currentQty, 0),
    [rolls, selected],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Böl: en az 1, TÜMÜ değil (backend: kaynakta bir kısım kalmalı). Taşı: en az 1 + hedef.
  const canSplit = selected.size > 0 && selected.size < total;
  const canMove = selected.size > 0 && Boolean(toBatchId);
  const canSubmit = !pending && total > 0 && (mode === "split" ? canSplit : canMove);

  const submit = () => (mode === "split" ? splitMut.mutate() : moveMut.mutate());

  // Mutasyon uçarken dialog kapanmasını engelle (ESC / dış tık / Vazgeç) —
  // yarıda kapanma kullanıcıyı sonucu görmeden bırakır (DispatchConfirmDialog deseni).
  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Parti Düzelt — {source?.batchNumber}</DialogTitle>
          <DialogDescription>
            Partiden top seç; yeni partiye ayır ya da başka partiye taşı.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* K16: kilitli partide sevk cerrahisi notu — her iki modda kalıcı. Başlık
              kilit-nötr: kilit zombi-sevk durumunu da kapsar (mal fiziken fasonda
              olmayabilir ama açık sevk kaydı outstanding'dir). */}
          {sourceLocked && (
            <Callout tone="warning" title="Partinin açık fason sevki var">
              Taşınan topların sevk kalemleri de hedef partiye taşınır/bölünür; irsaliye kaydı
              güncellenir.
            </Callout>
          )}

          {/* Mod seçici */}
          <div className="grid grid-cols-2 gap-2">
            <ModeButton
              active={mode === "split"}
              icon={<Scissors className="h-4 w-4" />}
              label="Yeni partiye ayır"
              onClick={() => setMode("split")}
            />
            <ModeButton
              active={mode === "move"}
              icon={<ArrowRightLeft className="h-4 w-4" />}
              label="Başka partiye taşı"
              disabled={targets.length === 0}
              onClick={() => setMode("move")}
            />
          </div>

          {/* Taşıma hedefi */}
          {mode === "move" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Hedef parti</label>
              {targets.length === 0 ? (
                <div className="rounded-md border border-dashed p-2 text-center text-xs italic text-muted-foreground">
                  Taşınacak başka parti yok.
                </div>
              ) : (
                <select
                  value={toBatchId}
                  onChange={(e) => setToBatchId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  {targets.map((t) => (
                    <option key={t.batchId} value={t.batchId}>
                      {t.batchNumber}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Top seçimi */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Toplar ({selected.size}/{total})
              </span>
              {total > 0 && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary hover:underline"
                  onClick={() =>
                    setSelected(allSelected ? new Set() : new Set(rolls.map((r) => r.id)))
                  }
                >
                  {allSelected ? "Hiçbirini" : "Tümünü seç"}
                </button>
              )}
            </div>
            {previewQ.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : total === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-xs italic text-muted-foreground">
                Bu partide taşınabilir/ayrılabilir top yok.
              </div>
            ) : (
              <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                {rolls.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <li
                      key={r.id}
                      className={cn(
                        "flex items-center gap-2 rounded px-1 py-0.5 text-xs",
                        !on && "opacity-50",
                      )}
                    >
                      <Checkbox checked={on} onCheckedChange={() => toggle(r.id)} />
                      <span className="flex-1 truncate text-muted-foreground">{r.status}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatNumber(r.currentQty, 0)} m
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {mode === "split" && selected.size > 0 && selected.size === total && (
              <div className="mt-1 text-[11px] text-warning">
                Bölmede partinin bir kısmı kaynakta kalmalı — TÜM toplar seçilemez.
              </div>
            )}
            {selected.size > 0 && (
              <div className="mt-1 text-right text-[11px] text-muted-foreground">
                Seçili: {formatNumber(totalMeters, 0)} m
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" disabled={pending} onClick={() => handleOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {pending
              ? "İşleniyor..."
              : mode === "split"
                ? `Yeni Partiye Ayır (${selected.size})`
                : `Taşı (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  active,
  icon,
  label,
  disabled,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
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
        "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors",
        disabled && "cursor-not-allowed opacity-50",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border hover:bg-muted/50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
