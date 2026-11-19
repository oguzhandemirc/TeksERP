// Sipariş iptali — önce sunucu önizlemesi (`GET /:id/cancel-preview`): iptal edilebilir mi, etkilenen her kayıt
// (sipariş, bağlı müşteri siparişleri, sevk/levent sayısı). İptal soft'tur (durum geçişi); sevkli sipariş 409.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { toastServerSuccess } from "@/lib/serverNotes";
import { targetText } from "./order-model";
import { warpingOrderService, WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingOrder } from "./types";

export function CancelOrderDialog({ order, onClose }: { order: WarpingOrder; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const qc = useQueryClient();
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "cancel-preview", order.id], queryFn: () => warpingOrderService.cancelPreview(order.id), staleTime: 0 });
  const cancel = useMutation({
    mutationFn: () => warpingOrderService.cancel(order.id, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "Sipariş iptal edildi.");
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
          <DialogTitle>{order.orderNo} iptal edilsin mi?</DialogTitle>
          <DialogDescription>Sipariş silinmez; durumu “İptal” olur ve kaydı geçmişte kalır.</DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
              <li>
                <b>{p.order.orderNo}</b> — {targetText(p.order)} → İptal
              </li>
              {p.salesOrders.map((s) => (
                <li key={s.id} className="text-muted-foreground">
                  Bağlı müşteri siparişi {s.orderNumber} ({s.customerName}) — bağ kalır, sipariş değişmez
                </li>
              ))}
              <li className="text-muted-foreground">İplik sevki: {p.affected.dispatches} · dönen levent: {p.affected.beams}</li>
            </ul>
            {!p.canCancel && <Callout tone="danger">{p.blockedReason ?? "Bu sipariş iptal edilemez."}</Callout>}
            {p.canCancel && (
              <FormField label="İptal sebebi" htmlFor="wo-cancel-reason" required hint="En az 3 karakter.">
                <Input id="wo-cancel-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!ok || cancel.isPending} onClick={() => cancel.mutate()}>
            {cancel.isPending ? "İptal ediliyor…" : "Siparişi iptal et"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
