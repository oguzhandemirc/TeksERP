// =============================================================================
// DOKUMA İŞİ — KAPAT / İPTAL diyalogları
// =============================================================================
// İkisi de bir DURUM GEÇİŞİDİR, silme değil: kapanış açık bir karardır
// (`plannedM`e ulaşmak kapatmaz), iptal yalnız bu satırı iptal eder — koşum ·
// duruş · doff · doğmuş top DOKUNULMAZ. Açık koşum varken backend 409 koşumları
// ADIYLA döner; mesaj aynen gösterilir (soyut "başarısız" yok).
// =============================================================================
import { useState } from "react";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { WeavingOrder } from "./types";

interface CloseProps {
  target: WeavingOrder | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
  isPending: boolean;
}

export function WeavingOrderCloseDialog({ target, onClose, onConfirm, isPending }: CloseProps) {
  const runs = target?.openRunCount ?? 0;
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`${target?.weavingOrderNumber ?? ""} kapatılsın mı?`}
      description={
        runs > 0
          ? `Bu işte ${runs} açık koşum var — sunucu kapanışı reddedecek; önce tabletten koşumları kapatın.`
          : "Kapanış açık bir karardır: hedefe ulaşılmış olması gerekmez. Kapanan iş salt-okunur olur, düzenlenemez."
      }
      confirmLabel="Kapat"
      isPending={isPending}
      onConfirm={() => (target ? onConfirm(target.id) : undefined)}
    />
  );
}

interface CancelProps {
  target: WeavingOrder | null;
  onClose: () => void;
  onConfirm: (id: string, reason: string) => Promise<void>;
  isPending: boolean;
}

export function WeavingOrderCancelDialog({ target, onClose, onConfirm, isPending }: CancelProps) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length > 0;
  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{target?.weavingOrderNumber} iptal edilsin mi?</DialogTitle>
          <DialogDescription>
            İptal yalnız bu işi iptal eder: kapanmış koşumlar, duruşlar, indirmeler ve doğmuş toplar yerinde
            kalır. Açık koşum varsa sunucu reddeder. Sebep zorunludur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="wo-cancel-reason">İptal sebebi</Label>
          <Textarea
            id="wo-cancel-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Müşteri vazgeçti, çözgü değişti…"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={!ok || isPending}
            onClick={() => target && void onConfirm(target.id, reason.trim())}
          >
            İptal Et
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
