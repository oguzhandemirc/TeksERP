import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Split, AlertTriangle, RefreshCw, Info, Clock } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { rollStatusLabels } from "@/types/enums";
import type { RollStatus } from "@/types/enums";
import { workOrderService, type SplitMode } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workOrderId: string;
  /** Ayrılacak parti (Batch) — kimlik. */
  batchId: string;
  batchNumber: string;
}

/** Mod başlıkları + hazır olma durumu. NEW_COLOR/UNDYED_MOVE backend'de henüz 409. */
const MODE_META: Record<SplitMode, { title: string; desc: string; ready: boolean }> = {
  REDYE_SAME_COLOR: {
    title: "Aynı renk — yeniden boya",
    desc: "Aynı iş emri, yeni parti. Seçilen toplar boyahaneye geri sarılıp aynı renge yeniden boyanır.",
    ready: true,
  },
  NEW_COLOR: {
    title: "Farklı renk — yeni iş emri",
    desc: "Seçilen toplar yeni bir iş emrine taşınıp yeni renge boyanır.",
    ready: false,
  },
  UNDYED_MOVE: {
    title: "Boyanmadan yeni iş emrine taşı",
    desc: "Fasonda bekleyen parti boyanmadan yeni bir iş emrine taşınır.",
    ready: false,
  },
};

export function SplitBranchModal({ open, onOpenChange, workOrderId, batchId, batchNumber }: Props) {
  const qc = useQueryClient();

  const [mode, setMode] = useState<SplitMode | null>(null);
  const [newColorId, setNewColorId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modal her açılışta temiz başlasın.
  useEffect(() => {
    if (open) {
      setMode(null);
      setNewColorId(null);
    }
  }, [open]);

  const previewQ = useQuery({
    queryKey: ["wo-split-preview", workOrderId, batchId],
    queryFn: () => workOrderService.getSplitPreview(workOrderId, batchId),
    enabled: open && Boolean(batchId),
    staleTime: 0,
  });
  const preview = previewQ.data?.data;

  // Önizleme yüklenince: tüm toplar seçili + varsayılan mod (öncelik REDYE).
  useEffect(() => {
    if (preview?.rolls) setSelected(new Set(preview.rolls.map((r) => r.id)));
  }, [preview?.rolls]);
  useEffect(() => {
    if (!preview?.allowedModes?.length) return;
    setMode((cur) =>
      cur && preview.allowedModes.includes(cur)
        ? cur
        : preview.allowedModes.includes("REDYE_SAME_COLOR")
          ? "REDYE_SAME_COLOR"
          : (preview.allowedModes[0] ?? null),
    );
  }, [preview?.allowedModes]);

  const splitMut = useMutation({
    mutationFn: () =>
      workOrderService.splitBranch(workOrderId, {
        batchId,
        mode: mode as SplitMode,
        newColorId: mode === "NEW_COLOR" ? newColorId : undefined,
        orderMode: "stock",
        rollIds: [...selected],
      }),
    onSuccess: (res) => {
      toast.success(
        res.message ??
          `Parti ayrıldı: ${res.data?.newBatchNumber ?? ""} (${selected.size} top)`,
      );
      void qc.invalidateQueries({ queryKey: ["work-order-branches", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-order-detail", workOrderId] });
      void qc.invalidateQueries({ queryKey: ["work-orders"] });
      // REDYE_SAME_COLOR: yeni parti AYNI iş emrinde — yeni sekme yok, panel yenilenir.
      onOpenChange(false);
    },
  });

  const totalRolls = preview?.rolls.length ?? 0;
  const allSelected = totalRolls > 0 && selected.size === totalRolls;
  const modeReady = mode ? MODE_META[mode].ready : false;
  const canSubmit =
    modeReady &&
    mode === "REDYE_SAME_COLOR" &&
    selected.size > 0 &&
    !splitMut.isPending;

  const toggleRoll = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const blocked = Boolean(preview && preview.allowedModes.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Split className="h-5 w-5 text-primary" />
            Partiyi ayır
          </DialogTitle>
          <DialogDescription>
            <span className="font-mono">{batchNumber}</span> partisini yeniden boyamaya al
            ya da yeni iş emrine ayır.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {previewQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : blocked ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{preview?.blockReason ?? "Bu parti şu an ayrılamaz."}</span>
            </div>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              {/* Mod seçimi — parti durumundan izinli modlar */}
              <div className="space-y-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Ayırma modu
                </div>
                <div className="grid gap-2">
                  {preview.allowedModes.map((m) => (
                    <ModeButton
                      key={m}
                      active={mode === m}
                      title={MODE_META[m].title}
                      desc={MODE_META[m].desc}
                      ready={MODE_META[m].ready}
                      onClick={() => setMode(m)}
                    />
                  ))}
                </div>
              </div>

              {/* Mod gövdesi */}
              {mode === "REDYE_SAME_COLOR" ? (
                <RedyeBody
                  rolls={preview.rolls}
                  selected={selected}
                  allSelected={allSelected}
                  totalRolls={totalRolls}
                  onToggle={toggleRoll}
                  onToggleAll={() =>
                    setSelected(allSelected ? new Set() : new Set(preview.rolls.map((r) => r.id)))
                  }
                />
              ) : mode ? (
                <div className="space-y-3">
                  {mode === "NEW_COLOR" && (
                    <div className="rounded-md border bg-muted/20 p-3">
                      <div className="mb-2 text-xs text-muted-foreground">Yeni renk</div>
                      <ColorPickerModal
                        value={newColorId}
                        onChange={setNewColorId}
                        allowNone={false}
                        label="Yeni Renk"
                        placeholder="Yeni renk seç..."
                      />
                    </div>
                  )}
                  <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      Bu mod (yeni iş emrine boyama/taşıma) <strong>henüz hazır değil</strong>.
                      Şu an yalnız <strong>aynı renk yeniden boyama</strong> kullanılabilir.
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={!canSubmit} onClick={() => splitMut.mutate()}>
            {splitMut.isPending ? "Ayrılıyor..." : "Ayır + Yeniden Boya"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Redye gövdesi: geri-sar bilgisi + taşınacak topların per-roll seçimi. */
function RedyeBody({
  rolls,
  selected,
  allSelected,
  totalRolls,
  onToggle,
  onToggleAll,
}: {
  rolls: { id: string; status: string; currentQty: number }[];
  selected: Set<string>;
  allSelected: boolean;
  totalRolls: number;
  onToggle: (id: string, checked: boolean) => void;
  onToggleAll: () => void;
}) {
  const selectedQty = useMemo(
    () => rolls.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.currentQty, 0),
    [rolls, selected],
  );
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Seçilen toplar <strong>aynı iş emrinde yeni bir partiye</strong> ayrılıp{" "}
          <strong>boyahaneye geri sarılır</strong> ve yeniden boyanır. Yeni parti kendi
          refakat kartını alır.
        </span>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Yeniden boyanacak toplar ({selected.size}/{totalRolls}) · {formatNumber(selectedQty, 0)} m
          </span>
          <button
            type="button"
            className="text-[11px] font-medium text-primary hover:underline"
            onClick={onToggleAll}
          >
            {allSelected ? "Hiçbirini" : "Tümünü seç"}
          </button>
        </div>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {rolls.map((r, i) => {
            const on = selected.has(r.id);
            return (
              <li
                key={r.id}
                className={cn("flex items-center gap-2 text-xs", !on && "opacity-50")}
              >
                <Checkbox checked={on} onCheckedChange={(v) => onToggle(r.id, Boolean(v))} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="font-mono text-muted-foreground">Top {i + 1}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-[10px] text-warning">
                    {rollStatusLabels[r.status as RollStatus] ?? r.status}
                  </Badge>
                  <span className="tabular-nums text-muted-foreground">
                    {formatNumber(r.currentQty, 0)} m
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        {selected.size > 0 && selected.size < totalRolls && (
          <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-warning">
            <Info className="h-3 w-3" />
            {totalRolls - selected.size} top kaynak partide kalacak
          </div>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  title,
  desc,
  ready,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  ready: boolean;
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
      <div className="flex items-center gap-2 font-medium">
        {title}
        {!ready && (
          <Badge variant="outline" className="gap-1 text-[9px] text-muted-foreground">
            <Clock className="h-2.5 w-2.5" /> Yakında
          </Badge>
        )}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{desc}</div>
    </button>
  );
}
