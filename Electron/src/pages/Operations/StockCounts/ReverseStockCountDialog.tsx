// =============================================================================
// TAMAMLANMIŞ SAYIMI STORNOLA — fark fişi tek belgede ters kayıtla geri alınır
// =============================================================================
// Önizleme dönecek HER topu ve geri alınacak HER iplik farkını listeler; engel
// varsa (sonraki sayım, elle geri alınmış top, kapalı iplik modülü) onay kapalıdır.
// Storno sayımı silmez: tutanak VOID olur, defterlere karşı satır yazılır.
// =============================================================================
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { rollStatusLabels, type RollStatus } from "@/types/enums";
import { getStockCountReversePreview, reverseStockCount, type StockCountDetail, type StockCountReversalPlan } from "./service";
import { qty } from "./stockCountRules";

interface Props {
  count: StockCountDetail;
  onOpenChange: (open: boolean) => void;
  onReversed: () => void;
}

export function ReverseStockCountDialog({ count, onOpenChange, onReversed }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useQuery({
    queryKey: ["stock-count", count.id, "reverse-preview"],
    queryFn: () => getStockCountReversePreview(count.id),
  });
  const plan = preview.data;
  const blocked = !plan || plan.blockers.length > 0 || plan.rolls.some((r) => r.blocker);

  const reverseM = useMutation({
    mutationFn: () => reverseStockCount(count.id, reason.trim()),
    onSuccess: (res) => {
      toast.success(res.message ?? `${res.data.countNo} stornolandı.`);
      // Storno ÜÇ yüzeyi oynatır: toplar rafına döner, iplik bakiyesi değişir ve
      // depo defterine satır yazılır. Kardeş `CompleteStockCountDialog` ile aynı küme.
      void qc.invalidateQueries({ queryKey: ["stock-counts"] });
      void qc.invalidateQueries({ queryKey: ["stock-count", count.id] });
      void qc.invalidateQueries({ queryKey: ["rolls"] });
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      void qc.invalidateQueries({ queryKey: ["warehouses", "movements"] });
      onOpenChange(false);
      onReversed();
    },
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sayım stornolansın mı?</DialogTitle>
          <DialogDescription>
            <b className="font-mono">{count.countNo}</b> fark fişi geri alınır: düşülen toplar önceki
            rafına döner, iplik farkı ters düzeltmeyle kapanır, tutanak geçersiz (VOID) olur. Sayım
            ve işaretleri kayıtta kalır.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading ? (
          <p className="text-sm text-muted-foreground">Önizleme yükleniyor…</p>
        ) : preview.isError ? (
          // ⚠️ Bu bir "storno yapılamaz" CEVABI DEĞİLDİR: istek düştü. Sessiz
          // kalsaydı düğme gerekçesiz kalıcı disabled görünürdü.
          <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            <p>
              Önizleme yüklenemedi — bu bir “storno yapılamaz” cevabı DEĞİLDİR, istek
              tamamlanmadı. Bağlantıyı kontrol edip tekrar deneyin.
            </p>
            <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : plan ? (
          <PlanBody plan={plan} />
        ) : null}
        <div>
          <Label htmlFor="sc-reverse-reason">Storno gerekçesi</Label>
          <Textarea
            id="sc-reverse-reason"
            className="mt-1"
            rows={2}
            maxLength={300}
            placeholder="Örn. raf etiketi yanlış okundu, toplar yerinde."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={blocked || reason.trim().length < 3 || reverseM.isPending}
            onClick={() => reverseM.mutate()}
          >
            {reverseM.isPending ? "Stornolanıyor…" : "Sayımı stornola"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanBody({ plan }: { plan: StockCountReversalPlan }) {
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
      {plan.blockers.length > 0 && (
        <ul className="list-disc rounded-md border border-destructive/40 p-3 pl-6 text-destructive">
          {plan.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <section>
        <h3 className="mb-1 font-semibold">
          Toplar ({plan.rolls.filter((r) => r.action === "RESTORE").length} rafına döner ·{" "}
          {plan.rolls.filter((r) => r.action !== "RESTORE").length} yalnız defter)
        </h3>
        {plan.rolls.length === 0 ? (
          <p className="text-muted-foreground">Bu sayım top düşürmemiş.</p>
        ) : (
          <ul className="space-y-1">
            {plan.rolls.map((r) => (
              <li key={r.rollId} className="flex flex-wrap gap-x-3 rounded border px-2 py-1">
                <span className="font-mono">{r.barcode ?? "—"}</span>
                <span>{qty(r.qty)} m</span>
                {r.blocker ? (
                  <span className="text-destructive">{r.blocker}</span>
                ) : r.action === "RESTORE" ? (
                  <span className="text-muted-foreground">
                    → {r.targetStatus ? (rollStatusLabels[r.targetStatus as RollStatus] ?? r.targetStatus) : "—"}
                  </span>
                ) : (
                  // Elle geri alınmış / defteri kapanmış top: statüye dokunulmaz.
                  <span className="text-muted-foreground">
                    {r.action === "LEDGER_ONLY" ? "yalnız defter kaydı" : "defteri zaten kapanmış"}
                    {r.note ? ` — ${r.note}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {plan.yarn.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Geri alınacak iplik farkları</h3>
          <ul className="space-y-1">
            {plan.yarn.map((y) => (
              <li key={y.itemId} className="flex flex-wrap gap-x-3 rounded border px-2 py-1">
                <span>{y.itemName}</span>
                <span>
                  {y.reversalKind === "ADJUST_IN" ? "+" : "−"}
                  {qty(Math.abs(Number(y.countNetKg)))} kg
                </span>
                <span className="text-muted-foreground">
                  bakiye {qty(y.balanceKg)} → {qty(y.balanceAfterKg)} kg
                </span>
                {Number(y.balanceAfterKg) < 0 && <span className="text-destructive">bakiye eksiye düşer</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
