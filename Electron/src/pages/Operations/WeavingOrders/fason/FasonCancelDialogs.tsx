// =============================================================================
// FASON DOKUMA — sevk iptali (gerekçe) · makbuz iptali (önizlemeli: canlı toplar engeller)
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fasonWeavingService } from "./service";
import { FASON_QUERY_KEY } from "./useFasonMutations";
import type { FasonDispatch, FasonReceipt } from "./types";

function ReasonBox({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Gerekçe</Label>
      <Textarea
        id={id}
        rows={3}
        maxLength={300}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </div>
  );
}

export function FasonDispatchCancelDialog({
  target,
  isPending,
  onClose,
  onConfirm,
}: {
  target: FasonDispatch;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sevk {target.dispatchNo} iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            Leventler HAZIR'a döner (çıkış defterine ters satır). Fasondan dönmüş leventi olan sevk iptal
            edilemez — önce dönüşü geri alın.
          </DialogDescription>
        </DialogHeader>
        <ReasonBox id="fd-cancel-reason" value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={!ok || isPending} onClick={() => onConfirm(reason.trim())}>
            Sevki İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FasonReceiptCancelDialog({
  target,
  isPending,
  onClose,
  onConfirm,
}: {
  target: FasonReceipt;
  isPending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const preview = useQuery({
    queryKey: [FASON_QUERY_KEY, "receipt-cancel-preview", target.id],
    queryFn: () => fasonWeavingService.receiptCancelPreview(target.id),
  });
  const p = preview.data?.data;
  const ok = reason.trim().length >= 3 && Boolean(p?.canCancel);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Makbuz {target.receiptNo} iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            Makbuz yalnız doğan topların HEPSİ iptal edilmişse iptal edilir: her top kendi iptal kapısından
            (sebep, etiket onayı) geçer, makbuz sonra kapanır.
          </DialogDescription>
        </DialogHeader>
        {preview.isError ? (
          <Callout tone="danger">Önizleme alınamadı — bu bir “engel yok” cevabı DEĞİLDİR.</Callout>
        ) : p ? (
          <ul className="max-h-60 space-y-1 overflow-y-auto text-sm">
            {p.bornRolls.map((r) => (
              <li key={r.id} className={r.blocks ? "text-amber-700" : "text-muted-foreground"}>
                {r.blocks ? "⛔" : "✓"} <span className="font-mono">{r.barcode ?? r.id.slice(0, 8)}</span> ·{" "}
                {r.initialQty} m · {r.status}
              </li>
            ))}
            {p.aliveCount > 0 && (
              <li className="font-medium text-amber-700">
                {p.aliveCount} top hâlâ kayıtta — önce Toplar sayfasından iptal edin.
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Önizleme yükleniyor…</p>
        )}
        <ReasonBox id="fr-cancel-reason" value={reason} onChange={setReason} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button variant="destructive" disabled={!ok || isPending} onClick={() => onConfirm(reason.trim())}>
            Makbuzu İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
