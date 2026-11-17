// Aktarma geçmişi (D6b-2) — `GET /:id/yarn-transfers`: bu siparişten giden ve bu siparişe gelen aktarma belgeleri ile
// storno belgeleri (en yeni üstte). Storno yalnız canlı TRANSFER belgesinde; önizleme (`cancel-preview`) etkilenen
// HER kalemi ve hedefin bugün tuttuğu kg'ı listeler, engel varsa sebep kutusu çizilmez.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/forms/FormField";
import { Input } from "@/components/ui/input";
import { fmtFactoryDateTime } from "@/lib/factory-time";
import { toastServerSuccess } from "@/lib/serverNotes";
import { cn } from "@/lib/utils";
import { warpingHoldingService, useWarpingTransfers } from "./holding-service";
import { fmtKg } from "./order-model";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingTransferBatch } from "./holding-types";

function TransferCancelDialog({ orderId, batch, onClose }: { orderId: string; batch: WarpingTransferBatch; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const pv = useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "transfer-cancel-preview", batch.batchId], queryFn: () => warpingHoldingService.transferCancelPreview(orderId, batch.batchId), staleTime: 0 });
  const m = useMutation({
    mutationFn: () => warpingHoldingService.transferCancel(orderId, batch.batchId, reason.trim()),
    onSuccess: (res) => {
      toastServerSuccess(res, "Aktarma iptal edildi.");
      void qc.invalidateQueries({ queryKey: [WARPING_ORDERS_QUERY_KEY] });
      onClose();
    },
  });
  const p = pv.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{batch.fromOrderNo} → {batch.toOrderNo} aktarması iptal edilsin mi?</DialogTitle>
          <DialogDescription>Aktarma silinmez; ters belge yazılır ve iplik yeniden {batch.fromOrderNo} siparişine sayılır.</DialogDescription>
        </DialogHeader>
        {pv.isLoading && <p className="text-sm text-muted-foreground">Etkilenen kayıtlar yükleniyor…</p>}
        {p && (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1 rounded-md border p-3" aria-label="Etkilenen kayıtlar">
              <li><b>{fmtKg(p.batch.totalKg)} kg</b> {batch.toOrderNo} → {batch.fromOrderNo}</li>
              {p.items.map((it) => (
                <li key={it.dispatchItemId} className="text-muted-foreground">
                  {it.code} · {it.dispatchNo} · {it.lotNo ? `lot ${it.lotNo}` : "lotsuz"} — {fmtKg(it.qtyKg)} kg geri döner (hedef bugün {fmtKg(it.targetHoldsKg)} kg tutuyor)
                </li>
              ))}
            </ul>
            {!p.canCancel && <Callout tone="danger">{p.blockedReason ?? "Bu aktarma iptal edilemez."}</Callout>}
            {p.canCancel && (
              <FormField label="İptal sebebi" htmlFor="wt-cancel-reason" required hint="En az 3 karakter.">
                <Input id="wt-cancel-reason" autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p?.canCancel || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "İptal ediliyor…" : "Aktarmayı iptal et"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BatchItem({ b, orderId, onCancel }: { b: WarpingTransferBatch; orderId: string; onCancel: () => void }) {
  const outgoing = b.fromWarpingOrderId === orderId;
  const isCancel = b.kind === "TRANSFER_CANCEL";
  const lines = b.rows.map((r) => `${r.code} ${r.lotNo ?? "lotsuz"} ${fmtKg(r.qtyKg)} kg`).join(" · ");
  return (
    <li className={cn("flex items-start justify-between gap-3 px-3 py-2 text-sm", b.cancelled && "text-muted-foreground")}>
      <span className="min-w-0">
        <span className="font-medium">{isCancel ? "Aktarma iptali" : outgoing ? `Giden → ${b.toOrderNo}` : `Gelen ← ${b.fromOrderNo}`}</span>
        {isCancel && <span> ({b.toOrderNo} → {b.fromOrderNo})</span>}
        <span className="ml-2 tabular-nums">{fmtKg(b.totalKg)} kg</span>
        <span className="ml-2 text-xs text-muted-foreground">{fmtFactoryDateTime(b.createdAt)}</span>
        {b.cancelled && <Badge variant="outline" className="ml-2 font-normal">İptal edildi</Badge>}
        <span className="block truncate text-xs text-muted-foreground">{lines}{b.note ? ` — ${b.note}` : ""}</span>
      </span>
      {!isCancel && !b.cancelled && (
        <PermissionGate permission="warping-order:write">
          <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-destructive" onClick={onCancel} aria-label={`${b.fromOrderNo} → ${b.toOrderNo} aktarmasını iptal et`} title="Aktarmayı iptal et"><Ban className="h-4 w-4" /></Button>
        </PermissionGate>
      )}
    </li>
  );
}

export function TransfersList({ orderId }: { orderId: string }) {
  const q = useWarpingTransfers(orderId);
  const [target, setTarget] = useState<WarpingTransferBatch | null>(null);
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1 pt-2" aria-label="Aktarmalar">
      <h3 className="text-sm font-semibold">Aktarmalar</h3>
      <ul className="divide-y rounded-md border">{rows.map((b) => <BatchItem key={b.batchId} b={b} orderId={orderId} onCancel={() => setTarget(b)} />)}</ul>
      {target && <TransferCancelDialog orderId={orderId} batch={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
