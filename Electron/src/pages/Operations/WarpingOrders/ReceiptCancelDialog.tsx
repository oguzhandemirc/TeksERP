// Kabul geri alma — önce `GET …/receipts/:key/cancel-preview`: etkilenen HER levent (geri alınabilir mi), deverecide
// serbest kalacak iplik (kalem × tutan sipariş), engeller (LIFO: yalnız en yeni kabul; kapanmış sipariş). Engel
// varsa sunucunun cümlesi gösterilir, sebep kutusu çizilmez. Levent silinmez; tipli ters kayıt yazılır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { toastServerSuccess } from "@/lib/serverNotes";
import type { YarnNames } from "./holding-model";
import { fmtKg, fmtM } from "./order-model";
import { yarnText } from "./YarnLabel";
import { warpingReceiveService } from "./receive-service";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingReceipt, WarpingReceiptCancelPreview } from "./receive-types";

function AffectedList({ p, names, orderId }: { p: WarpingReceiptCancelPreview; names: YarnNames; orderId: string }) {
  return (
    <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
      {p.beams.map((b) => (
        <li key={b.id}>
          <b>{b.beamNo}</b> · {b.lengthM ? `${fmtM(b.lengthM)} m` : "—"}{b.blocker ? <span className="text-destructive"> — {b.blocker}</span> : p.blockers.length === 0 && " → İptal olur"}
        </li>
      ))}
      {p.released.map((r) => (
        <li key={`${r.dispatchItemId}|${r.holderWarpingOrderId}`} className="text-muted-foreground">
          {yarnText(names.get(r.yarnItemId)?.name, names.get(r.yarnItemId)?.code)} — {fmtKg(r.kg)} kg {r.dispatchNo} sevkinde yeniden deverecide görünür{r.holderWarpingOrderId !== orderId && " (devir, asıl siparişe döner)"}
        </li>
      ))}
    </ul>
  );
}

interface Props { orderId: string; receipt: WarpingReceipt; names: YarnNames; onClose: () => void }

export function ReceiptCancelDialog({ orderId, receipt, names, onClose }: Props) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "receipt-cancel-preview", receipt.receiptKey], queryFn: () => warpingReceiveService.cancelPreview(orderId, receipt.receiptKey), staleTime: 0 });
  const cancel = useMutation({
    mutationFn: () => warpingReceiveService.cancel(orderId, receipt.receiptKey, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kabul geri alındı.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  const blocked = !p || p.blockers.length > 0;
  const ok = !blocked && reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Levent kabulü geri alınsın mı?</DialogTitle>
          <DialogDescription>
            {receipt.deliveryNoteNo ? `İrsaliye ${receipt.deliveryNoteNo} · ` : ""}{receipt.liveBeamCount} levent · {fmtM(receipt.lengthM)} m. Leventler silinmez, “İptal” olur; düşülen iplik deverecide yeniden görünür.
          </DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <AffectedList p={p} names={names} orderId={orderId} />
            {p.blockers.length > 0 && (
              <Callout tone="danger">{p.blockers.length === 1 ? p.blockers[0] : <ul className="list-disc pl-4">{p.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}</Callout>
            )}
            {!blocked && (
              <FormField label="Geri alma sebebi" htmlFor="wrc-reason" required hint="En az 3 karakter.">
                <Input id="wrc-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "Geri alınıyor…" : "Kabulü geri al"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
