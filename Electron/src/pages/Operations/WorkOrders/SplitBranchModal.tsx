import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Split, AlertTriangle, ArrowRight, RefreshCw, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import { useTabsStore } from "@/store/tabs";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { rollStatusLabels } from "@/types/enums";
import type { RollStatus } from "@/types/enums";
import { workOrderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  /** Ayrılacak parti = sevk lane'i (batchSplitId === dispatchId). */
  dispatchId: string;
  dispatchNo: string;
}

export function SplitBranchModal({ open, onOpenChange, workOrderId, dispatchId, dispatchNo }: Props) {
  const qc = useQueryClient();
  const openTab = useTabsStore((s) => s.openTab);

  const [newColorId, setNewColorId] = useState<string | null>(null);
  const [orderMode, setOrderMode] = useState<"stock" | "keep">("stock");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal her açılışta temiz başlasın.
  useEffect(() => {
    if (open) {
      setNewColorId(null);
      setOrderMode("stock");
    }
  }, [open]);

  const previewQ = useQuery({
    queryKey: ["wo-split-preview", workOrderId, dispatchId],
    queryFn: () => workOrderService.getSplitPreview(workOrderId, dispatchId),
    enabled: open && Boolean(dispatchId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  // Önizleme yüklenince: tüm toplar seçili (default).
  useEffect(() => {
    if (preview?.rolls) setSelected(new Set(preview.rolls.map((r) => r.id)));
  }, [preview?.rolls]);

  const splitMut = useMutation({
    mutationFn: () =>
      workOrderService.splitBranch(workOrderId, {
        batchSplitId: dispatchId,
        newColorId: newColorId as string,
        orderMode,
        rollIds: [...selected],
      }),
    onSuccess: (res) => {
      const newId = res.data?.newWorkOrderId;
      toast.success(
        `Parti yeni iş emrine ayrıldı: ${res.data?.batchNumber ?? ""} (${res.data?.movedRollCount ?? 0} top)`,
      );
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      onOpenChange(false);
      // Yeni WO yeni sekmede + refakat kartı yazdırma diyaloğu otomatik açık:
      // ayrılan parti fiziksel olarak ESKİ kartı taşıyor — yeni kart basılıp
      // demete takılmadan istasyon okutmaları eski (yanlış) WO'ya düşer.
      if (newId) {
        openTab(`/operations/work-orders/${newId}`, {
          forceNew: true,
          state: { printTravelerCard: true },
        });
      }
    },
  });

  const totalRolls = preview?.rolls.length ?? 0;
  const allSelected = totalRolls > 0 && selected.size === totalRolls;
  const canSubmit =
    Boolean(preview?.canSplit && newColorId) && selected.size > 0 && !splitMut.isPending;
  const toggleRoll = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" />
            Partiyi yeni iş emrine ayır
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{dispatchNo}</span> partisi, birebir aynı rota
            ve özelliklerle yeni bir iş emrine taşınır; sadece renk değişir.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : preview ? (
            !preview.canSplit ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{preview.blockReason ?? "Bu parti ayrılamaz."}</span>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {/* Mod açıklaması: boyanmadan devam mı, yeniden boyama mı? */}
                {preview.mode === "redye" ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Bu parti <strong>boyandı</strong> (şu an:{" "}
                      {preview.currentStep?.stationName ?? "—"}). Yeni renk için{" "}
                      <strong>boyahaneye geri</strong> gönderilip yeniden boyanacak; yeni iş
                      emri <strong>{preview.reEntryStep?.stationName ?? "boyahane"}</strong>{" "}
                      adımından başlar.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Parti boyahanede (boyanmadan). Yeni iş emri kaldığı yerden devam eder;
                      yeni renk dönüşte uygulanır.
                    </span>
                  </div>
                )}

                {/* Taşınacak toplar — per-roll seçim (yalnız seçilenler yeni WO'ya) */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Taşınacak toplar ({selected.size}/{totalRolls})
                    </span>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary hover:underline"
                      onClick={() =>
                        setSelected(allSelected ? new Set() : new Set(preview.rolls.map((r) => r.id)))
                      }
                    >
                      {allSelected ? "Hiçbirini" : "Tümünü seç"}
                    </button>
                  </div>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {preview.rolls.map((r) => {
                      const on = selected.has(r.id);
                      return (
                        <li
                          key={r.id}
                          className={cn("flex items-center gap-2 text-xs", !on && "opacity-50")}
                        >
                          <Checkbox checked={on} onCheckedChange={(v) => toggleRoll(r.id, Boolean(v))} />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="font-mono">{r.barcode ?? "açık kumaş"}</span>
                            {r.itemName && (
                              <span className="truncate text-muted-foreground">{r.itemName}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <Badge variant="outline" className="text-[10px] text-warning">
                              {rollStatusLabels[r.status as RollStatus] ?? r.status}
                            </Badge>
                            <span className="tabular-nums text-muted-foreground">{r.currentQty} m</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {selected.size > 0 && selected.size < totalRolls && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      {totalRolls - selected.size} top kaynak iş emrinde kalacak
                    </div>
                  )}
                </div>

                {/* Renk değişimi: kaynak → yeni */}
                <div className="rounded-md border bg-muted/20 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Renk:</span>
                    <Badge variant="muted" className="gap-1 text-[10px]">
                      {preview.sourceColor?.hex && (
                        <span
                          className="h-2 w-2 rounded-full border"
                          style={{ backgroundColor: preview.sourceColor.hex }}
                        />
                      )}
                      {preview.sourceColor?.name ?? "—"}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium text-primary">yeni renk</span>
                  </div>
                  <ColorPickerModal
                    value={newColorId}
                    onChange={setNewColorId}
                    allowNone={false}
                    label="Yeni Renk"
                    placeholder="Yeni renk seç..."
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Yeni renk, parti yeni iş emrine boyahaneden dönüp kabul edilince uygulanır.
                  </p>
                </div>

                {/* Sipariş bağı — sadece kaynak siparişe bağlıysa seçim sun */}
                {preview.hasOrderLinks ? (
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Sipariş bağı
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <OrderModeButton
                        active={orderMode === "stock"}
                        title="Stoğa dönsün"
                        desc="Sipariş bağı kopar"
                        onClick={() => setOrderMode("stock")}
                      />
                      <OrderModeButton
                        active={orderMode === "keep"}
                        title="Siparişe bağlı kalsın"
                        desc="Aynı sipariş kalemleri"
                        onClick={() => setOrderMode("keep")}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Kaynak iş emri siparişe bağlı değil — yeni iş emri stok üretimi olur.
                  </p>
                )}
              </div>
            )
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={() => splitMut.mutate()}>
            {splitMut.isPending
              ? "Ayrılıyor..."
              : preview?.mode === "redye"
                ? "Ayır + Yeniden Boya"
                : "Yeni İş Emrine Ayır"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrderModeButton({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left text-xs transition-colors",
        active ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div className="font-medium">{title}</div>
      <div className="text-[11px] text-muted-foreground">{desc}</div>
    </button>
  );
}
