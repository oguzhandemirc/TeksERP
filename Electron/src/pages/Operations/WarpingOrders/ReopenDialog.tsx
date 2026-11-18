// Yeniden açma — önce `GET /:id/reopen-preview`: geri alınacak HER fire satırı, iade ve geri aktarım ayrı ayrı; engel
// varsa sunucunun cümlesi, sebep kutusu çizilmez. Kapanış kaydı silinmez; ters kayıtlar bugüne yazılır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { toastServerSuccess } from "@/lib/serverNotes";
import { fmtKg } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { warpingSettleService } from "./settle-service";
import type { WarpingOrder } from "./types";
import type { WarpingReopenPreview } from "./settle-types";

/** Kalem kimliği → "IPL-5X · FS1 · lot L-501" (sevk listesinden; bulunamazsa nötr ad). */
export type ItemLabels = Map<string, string>;
export const labelOf = (m: ItemLabels, id: string | null) => (id ? m.get(id) : undefined) ?? "kalem";

function AffectedList({ p, labels }: { p: WarpingReopenPreview; labels: ItemLabels }) {
  const empty = p.wastesToCancel.length + p.returnsToCancel.length + p.transfersToCancel.length === 0;
  return (
    <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
      <li><b>{p.order.orderNo}</b> → yeniden “Sevkte”</li>
      {p.wastesToCancel.map((w) => <li key={w.wasteId} className="text-muted-foreground">Fire geri alınır: {labelOf(labels, w.dispatchItemId)} — {fmtKg(w.qtyKg)} kg deverecide yeniden görünür</li>)}
      {p.returnsToCancel.map((r) => <li key={r.movementId} className="text-muted-foreground">İade geri alınır: {labelOf(labels, r.dispatchItemId)} — {fmtKg(r.qtyKg)} kg depodan düşer, deverecide yeniden görünür</li>)}
      {p.transfersToCancel.map((t) => <li key={t.transferId} className="text-muted-foreground">Geri aktarım iptal: {labelOf(labels, t.dispatchItemId)} — {fmtKg(t.qtyKg)} kg</li>)}
      {empty && <li className="text-muted-foreground">Kapanışta fire ya da iade yazılmamış — yalnız durum değişir.</li>}
    </ul>
  );
}

export function ReopenDialog({ order, labels, onClose }: { order: WarpingOrder; labels: ItemLabels; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "reopen-preview", order.id], queryFn: () => warpingSettleService.reopenPreview(order.id), staleTime: 0, gcTime: 0 });
  const save = useMutation({
    mutationFn: () => warpingSettleService.reopen(order.id, reason.trim()),
    onSuccess: (res) => { toastServerSuccess(res, "Sipariş yeniden açıldı."); void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] }); onClose(); },
  });
  const p = pv.data;
  const ok = Boolean(p?.canReopen) && reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{order.orderNo} yeniden açılsın mı?</DialogTitle>
          <DialogDescription>Kapanış silinmez; fire ve iade ters kayıtla geri alınır, kapanış geçmişte “yeniden açıldı” olarak kalır.</DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <AffectedList p={p} labels={labels} />
            {p.blockers.length > 0 && <Callout tone="danger"><ul className="list-disc pl-4">{p.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></Callout>}
            {p.canReopen && (
              <FormField label="Yeniden açma sebebi" htmlFor="wro-reason" required hint="En az 3 karakter.">
                <Input id="wro-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Açılıyor…" : "Yeniden aç"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
