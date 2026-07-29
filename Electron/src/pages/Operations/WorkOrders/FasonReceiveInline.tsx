import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { workOrderService } from "./service";
import {
  type FasonReceiveMode,
  defaultPieces,
  hasMeterDiff,
  meterDiff,
  piecesTotal,
} from "./fasonReceive.helper";

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
 *
 * Varsayılan: boyahane topları DİKEREK tek parça döndürür → tek parça, metre =
 * giden toplam ("Tek parça (dikili)"). İstisna "Adet adet geldi": top başına parça.
 * Giden↔dönen metraj farkında kabul iki tık ister (mobil FARK onayının karşılığı).
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
  const sentQtys = dispatch.rolls.map((r) => r.currentQty);
  const [mode, setMode] = useState<FasonReceiveMode>("SINGLE");
  const [pieces, setPieces] = useState<number[]>(() => defaultPieces(sentQtys, "SINGLE"));
  // Fark onayı: metraj tutmuyorsa ilk tık uyarıyı açar, ikinci tık kabul eder.
  const [diffArmed, setDiffArmed] = useState(false);
  // Kabul sonrası makbuz — kapatınca onDone() ile paneli kapatır.
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const switchMode = (next: FasonReceiveMode) => {
    if (next === mode) return;
    setMode(next);
    setPieces(defaultPieces(sentQtys, next));
    setDiffArmed(false);
  };

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
      // Kabul makbuzunu göster (kaynak lazy-init ile ilk açılışta donar). Makbuz
      // kapanınca onDone() paneli kapatır. receiptId dönmezse doğrudan kapat.
      const id = (res.data as { id?: string } | null)?.id ?? null;
      if (id) setReceiptId(id);
      else onDone();
    },
  });

  const sentTotal = piecesTotal(sentQtys);
  const total = piecesTotal(pieces);
  const diff = meterDiff(sentQtys, pieces);
  const mismatch = hasMeterDiff(sentQtys, pieces);
  const canSubmit = pieces.some((q) => q > 0) && !mut.isPending;

  const handleSubmit = () => {
    if (mismatch && !diffArmed) {
      setDiffArmed(true);
      return;
    }
    mut.mutate();
  };

  const modeBtn = (active: boolean) =>
    `rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "bg-background text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mt-1.5 space-y-2">
      <div className="text-[10px] text-muted-foreground">
        Dönen açık kumaş — <b>{dispatch.rolls.length} top</b> ({formatNumber(sentTotal, 2)} m)
        gitti.{" "}
        {mode === "SINGLE"
          ? "Dikili TEK parça döndü varsayıldı; metre = giden toplam."
          : "Gittiği adet kadar parça döndü; her satır kendi sevk metresi."}
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => switchMode("SINGLE")} className={modeBtn(mode === "SINGLE")}>
          Tek parça (dikili)
        </button>
        <button type="button" onClick={() => switchMode("PER_ROLL")} className={modeBtn(mode === "PER_ROLL")}>
          Adet adet geldi ({dispatch.rolls.length})
        </button>
      </div>
      <ul className="space-y-1">
        {pieces.map((q, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span className="w-14 shrink-0 text-[10px] text-muted-foreground">Parça {i + 1}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={q || ""}
              onChange={(e) => {
                setDiffArmed(false);
                setPieces((p) =>
                  p.map((x, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : x)),
                );
              }}
              className="w-24 rounded border bg-background px-2 py-0.5 text-right text-[11px] tabular-nums outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-[10px] text-muted-foreground">m</span>
            {pieces.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  setDiffArmed(false);
                  setPieces((p) => p.filter((_, j) => j !== i));
                }}
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
          onClick={() => {
            setDiffArmed(false);
            setPieces((p) => [...p, 0]);
          }}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Parça ekle
        </button>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          Toplam: {formatNumber(total, 2)} m
        </span>
      </div>
      {mismatch && diffArmed && (
        <div className="rounded border border-amber-500 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400">
          {/* Fark eşiği 0.01 m — gösterim de 2 hane: 0.03'lük gerçek fark "0 m" görünmesin. */}
          <b>{diff > 0 ? "FAZLA DÖNEN" : "EKSİK DÖNEN"}:</b> Sevk {formatNumber(sentTotal, 2)} m ·
          Dönen {formatNumber(total, 2)} m · fark {diff > 0 ? "+" : ""}
          {formatNumber(diff, 2)} m. Eminseniz tekrar basın.
        </div>
      )}
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onDone} className="rounded border px-1.5 py-0.5 text-[11px]">
          Vazgeç
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className={`rounded px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50 ${
            mismatch && diffArmed ? "bg-amber-600" : "bg-primary"
          }`}
        >
          {mut.isPending
            ? "Kabul ediliyor..."
            : mismatch && diffArmed
              ? "Farka Rağmen Kabul Et"
              : "Fason Kabul Et"}
        </button>
      </div>

      <PrintedDocDialog
        docType="SUBCONTRACTOR_RECEIPT"
        sourceId={receiptId}
        open={Boolean(receiptId)}
        onOpenChange={(o) => {
          if (!o) {
            setReceiptId(null);
            onDone();
          }
        }}
        title="Fason Kabul Makbuzu"
        description="Fasondan dönen malın kabul belgesi."
        writePermission="workorder:write"
      />
    </div>
  );
}
