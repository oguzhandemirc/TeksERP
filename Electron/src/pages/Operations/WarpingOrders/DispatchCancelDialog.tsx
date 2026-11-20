// Sevk iptali — önce `GET …/dispatches/:dispatchId/cancel-preview`: etkilenen HER iplik kalemi (depoya geri dönecek kg),
// LIFO engeli, sipariş "Açık"a döner mi. Sevk silinmez; iptal ters stok hareketi yazar, belge geçmişte "İptal" görünür.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { toastServerSuccess } from "@/lib/serverNotes";
import { fmtKg } from "./order-model";
import { yarnText } from "./YarnLabel";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import { warpingYarnService } from "./yarn-service";
import type { WarpingDispatchCancelPreview, WarpingDispatchRow } from "./yarn-types";

function AffectedList({ p, row }: { p: WarpingDispatchCancelPreview; row: WarpingDispatchRow }) {
  const byItem = new Map(row.items.map((i) => [i.dispatchItemId, i]));
  return (
    <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
      <li><b>{p.dispatch.dispatchNo}</b> → İptal</li>
      {p.items.map((it) => {
        const r = byItem.get(it.dispatchItemId);
        return (
          <li key={it.dispatchItemId} className="text-muted-foreground">
            {r ? yarnText(r.yarnItemName, r.yarnItemCode) : it.yarnItemId} · {it.lotNo ? `lot ${it.lotNo}` : "lotsuz"} — {fmtKg(it.outKg)} kg {r?.warehouseName ?? "depoya"} geri girer
          </li>
        );
      })}
      {(p.beamBodies?.length ?? 0) > 0 && <li>Boş gövdeler depoya döner (ters kayıt): {p.beamBodies!.map((b) => b.bodyNo).join(", ")}</li>}
      {p.orderReturnsToOpen && <li className="text-muted-foreground">Siparişte başka canlı sevk kalmaz → sipariş “Açık” durumuna döner.</li>}
    </ul>
  );
}

export function DispatchCancelDialog({ orderId, row, onClose }: { orderId: string; row: WarpingDispatchRow; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "dispatch-cancel-preview", row.dispatchId], queryFn: () => warpingYarnService.dispatchCancelPreview(orderId, row.dispatchId), staleTime: 0 });
  const cancel = useMutation({
    mutationFn: () => warpingYarnService.cancelDispatch(orderId, row.dispatchId, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "Sevk iptal edildi.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  const ok = Boolean(p?.canCancel) && reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{row.dispatchNo} sevki iptal edilsin mi?</DialogTitle>
          <DialogDescription>Sevk silinmez; iplik depoya geri girer ve belge geçmişte “İptal” olarak kalır.</DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <AffectedList p={p} row={row} />
            {!p.canCancel && <Callout tone="danger">{p.blockedReason ?? "Bu sevk iptal edilemez."}</Callout>}
            {p.canCancel && (
              <FormField label="İptal sebebi" htmlFor="wd-cancel-reason" required hint="En az 3 karakter.">
                <Input id="wd-cancel-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "İptal ediliyor…" : "Sevki iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
