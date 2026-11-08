// Emanet çıkış iptali — önce sunucu önizlemesi: READY'ye dönecek HER levent, depoya geri yazılacak HER iplik satırı ve
// damgalanacak levent sarım hizmet bağları listelenir. İptal belgenin TAMAMINI ters kayıtla geri alır (ileri kayıt silinmez).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CONSIGNMENT_DISPATCHES_QUERY_KEY,
  cancelConsignmentDispatch,
  getConsignmentCancelPreview,
} from "./service";
import type { ConsignmentDispatchCancelPreview } from "./types";
import { blockedReasonText, fmtQty, invoiceStatusText, KIND_LABEL } from "./consignmentText";

interface Props {
  dispatchId: string | null;
  onOpenChange: (o: boolean) => void;
}

export function ConsignmentCancelDialog({ dispatchId, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [dispatchId]);
  const pq = useQuery({
    queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY, "cancel-preview", dispatchId],
    queryFn: () => getConsignmentCancelPreview(dispatchId!),
    enabled: Boolean(dispatchId),
    staleTime: 0,
  });
  const m = useMutation({
    mutationFn: () => cancelConsignmentDispatch(dispatchId!, reason.trim()),
    onSuccess: (d) => {
      toast.success(`${d.dispatchNo} iptal edildi — kalemler geri alındı.`);
      void qc.invalidateQueries({ queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY] });
      void qc.invalidateQueries({ queryKey: ["warp-beams"] });
      void qc.invalidateQueries({ queryKey: ["yarn"] });
      onOpenChange(false);
    },
    onError: () => void pq.refetch(),
  });
  const p = pq.data;
  const reasonOk = reason.trim().length >= 3;
  return (
    <Dialog open={Boolean(dispatchId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Emanet çıkışı iptal edilsin mi?{p ? ` — ${p.dispatchNo}` : ""}</DialogTitle>
          <DialogDescription>
            İptal belgenin tamamını geri alır: leventler yeniden “Hazır” olur, iplik aynı lot ve depoya geri
            yazılır. Çıkış kaydı silinmez; karşısına ters kayıt düşer.
          </DialogDescription>
        </DialogHeader>
        {pq.isLoading ? (
          <p className="text-sm text-muted-foreground">Etkilenen kayıtlar ölçülüyor…</p>
        ) : pq.isError || !p ? (
          <div className="text-sm">
            <p className="text-destructive">Önizleme alınamadı — iptal yapılmadı.</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void pq.refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <CancelPreviewBody p={p} />
            <div className="space-y-1">
              <Label htmlFor="cd-cancel-reason">İptal gerekçesi</Label>
              <Textarea
                id="cd-cancel-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="En az 3 karakter"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={!p?.canCancel || !reasonOk || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelPreviewBody({ p }: { p: ConsignmentDispatchCancelPreview }) {
  return (
    <>
      {!p.canCancel && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          data-testid="cancel-blocked"
        >
          İptal edilemez: {blockedReasonText(p.blockedReason)}
        </p>
      )}
      <div className="max-h-[30vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Tür</th>
              <th className="p-2 text-left">Kayıt</th>
              <th className="p-2 text-right">Geri alınacak</th>
            </tr>
          </thead>
          <tbody>
            {p.affected.map((a) => (
              <tr key={`${a.kind}:${a.refId}:${a.label}`} className="border-t">
                <td className="p-2">{KIND_LABEL[a.kind]}</td>
                <td className="p-2">{a.label}</td>
                <td className="p-2 text-right tabular-nums">{fmtQty(a.qty, a.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.billingLinks.length > 0 && (
        <div className="space-y-1 text-sm" data-testid="cancel-billing-links">
          <p className="font-medium">Levent sarım hizmet bağları (iptalde damgalanır, silinmez):</p>
          <ul className="list-disc pl-5">
            {p.billingLinks.map((b) => (
              <li key={b.linkId}>
                Fatura {b.invoiceNo ?? "(numarasız taslak)"} · {invoiceStatusText(b.invoiceStatus)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
