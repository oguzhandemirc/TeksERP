// Kabul belgesini iptal et (devere ek E6) — önce `GET /api/warping-receive-docs/:id/cancel-preview`: etkilenen HER
// sipariş ve levent, deverecide yeniden görünecek iplik, engeller. Hep-ya-hiç: tek engel bile varsa sunucunun cümleleri
// gösterilir, sebep kutusu çizilmez. Leventler silinmez; tipli ters kayıt (bugüne) yazılır.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { toastServerSuccess } from "@/lib/serverNotes";
import { fmtKg, fmtM } from "@/pages/Operations/WarpingOrders/order-model";
import { yarnText } from "@/pages/Operations/WarpingOrders/YarnLabel";
import { WARPING_ORDERS_QUERY_KEY } from "@/pages/Operations/WarpingOrders/service";
import { WARPING_RECEIVE_DOCS_QUERY_KEY, warpingReceiveDocService } from "@/pages/Operations/WarpingOrders/receive-doc-service";
import type { WarpingReceiveDoc, WarpingReceiveDocCancelPreview } from "@/pages/Operations/WarpingOrders/receive-doc-types";

function AffectedOrders({ p }: { p: WarpingReceiveDocCancelPreview }) {
  return (
    <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-md border p-3" aria-label="Etkilenen kayıtlar">
      {p.orders.map((o) => (
        <section key={o.receiptKey} className="space-y-1">
          <h3 className="font-semibold">{o.orderNo}{o.alreadyCancelled && <span className="font-normal text-muted-foreground"> — zaten geri alınmış, atlanır</span>}</h3>
          {!o.alreadyCancelled && (
            <ul className="space-y-0.5 pl-3">
              {o.beams.filter((b) => b.live).map((b) => (
                <li key={b.id}>
                  <b>{b.beamNo}</b> · {b.lengthM ? `${fmtM(b.lengthM)} m` : "—"}{b.blocker ? <span className="text-destructive"> — {b.blocker}</span> : p.cancellable && " → İptal olur"}
                </li>
              ))}
              {o.released.map((r) => (
                <li key={`${r.dispatchItemId}|${r.holderWarpingOrderId}`} className="text-muted-foreground">
                  {yarnText(r.yarnName, r.yarnCode)} — {fmtKg(r.kg)} kg {r.dispatchNo} sevkinde yeniden deverecide görünür{r.holderWarpingOrderId !== o.warpingOrderId && ` (devir, ${r.holderOrderNo || "asıl sipariş"}e döner)`}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function ReceiveDocCancelDialog({ doc, onClose }: { doc: WarpingReceiveDoc; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const pv = useQuery({ queryKey: [WARPING_RECEIVE_DOCS_QUERY_KEY, "cancel-preview", doc.id], queryFn: () => warpingReceiveDocService.cancelPreview(doc.id), staleTime: 0, retry: false });
  const cancel = useMutation({
    mutationFn: () => warpingReceiveDocService.cancel(doc.id, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "Kabul belgesi geri alındı.");
      void qc.invalidateQueries({ queryKey: [WARPING_RECEIVE_DOCS_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  const blocked = !p || !p.cancellable;
  const ok = !blocked && reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{doc.docNo} iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            Belgedeki bütün siparişlerin leventleri tek işlemde geri alınır{p ? ` (${p.totals.orderCount} sipariş · ${p.totals.beamCount} levent · ${fmtM(p.totals.lengthM)} m)` : ""}. Leventler silinmez, “İptal” olur; düşülen iplik deverecide yeniden görünür. Tek siparişi geri almak için sipariş sayfasını kullanın.
          </DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <AffectedOrders p={p} />
            {p.blockers.length > 0 && (
              <Callout tone="danger">
                <p className="mb-1 font-medium">Belge geri alınamaz — hiçbir levent değişmedi:</p>
                <ul className="list-disc pl-4">{p.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
              </Callout>
            )}
            {!blocked && (
              <FormField label="İptal sebebi" htmlFor="rdc-reason" required hint="En az 3 karakter; her levent kaydına yazılır.">
                <Input id="rdc-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "Geri alınıyor…" : "Belgeyi iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
