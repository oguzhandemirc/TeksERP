import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { workOrderService } from "./service";

interface OpenDispatch {
  dispatchId: string;
  dispatchNo: string;
  stepId: string;
  subcontractorId: string;
  stepName: string | null;
  rolls: { id: string; barcode: string | null; currentQty: number }[];
}

/**
 * "Fason Kabul ile içeri al" — Konumu Düzelt modalında fasondaki topu içeri almanın
 * gerçek-olay kısayolu (ham teleport yerine). Orijinal sevk topları emekliye ayrılır;
 * dönen açık-kumaş PARÇALARI (metraj) yeni toplar olarak doğar (renk appliesColor'da
 * WO hedef renginden otomatik). Sahadaki tam form değil, minimal admin düzeltmesi.
 */
export function FasonReceiveInline({
  workOrderId,
  dispatch,
  onDone,
}: {
  workOrderId: string;
  dispatch: OpenDispatch;
  onDone: () => void;
}) {
  // Dönen parçalar — varsayılan: sevk edilen her top için bir parça (metraj = gönderilen).
  const [pieces, setPieces] = useState<number[]>(() => dispatch.rolls.map((r) => r.currentQty));

  const mut = useMutation({
    mutationFn: () =>
      workOrderService.receiveFason({
        workOrderId,
        stepId: dispatch.stepId,
        subcontractorId: dispatch.subcontractorId,
        returns: dispatch.rolls.map((r) => ({ rollId: r.id })),
        newRolls: pieces.filter((q) => q > 0).map((qty) => ({ qty })),
      }),
    onSuccess: (res) => {
      toast.success(res.message ?? "Fason kabul yapıldı — toplar içeri alındı");
      onDone();
    },
  });

  const total = pieces.reduce((s, q) => s + (q > 0 ? q : 0), 0);
  const canSubmit = pieces.some((q) => q > 0) && !mut.isPending;

  return (
    <div className="mt-1.5 space-y-2">
      <div className="text-[10px] text-muted-foreground">
        Dönen açık kumaş parçaları — <b>{dispatch.rolls.length} top</b> gitti; kaç parça / kaç metre
        döndüyse girin (renk otomatik uygulanır).
      </div>
      <ul className="space-y-1">
        {pieces.map((q, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-14 shrink-0 text-[10px] text-muted-foreground">Parça {i + 1}</span>
            <input
              type="number"
              min={0}
              step={1}
              value={q || ""}
              onChange={(e) =>
                setPieces((p) =>
                  p.map((x, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : x)),
                )
              }
              className="w-24 rounded border bg-background px-2 py-0.5 text-right text-[11px] tabular-nums outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-[10px] text-muted-foreground">m</span>
            {pieces.length > 1 && (
              <button
                type="button"
                onClick={() => setPieces((p) => p.filter((_, j) => j !== i))}
                className="text-destructive hover:opacity-70"
                aria-label="Parçayı kaldır"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setPieces((p) => [...p, 0])}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Parça ekle
        </button>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          Toplam: {formatNumber(total, 0)} m
        </span>
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded border px-1.5 py-0.5 text-[11px]">
          Vazgeç
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => mut.mutate()}
          className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {mut.isPending ? "Kabul ediliyor..." : "Fason Kabul Et"}
        </button>
      </div>
    </div>
  );
}
