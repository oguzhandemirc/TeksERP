// Siparişi elle kapat — sebep zorunlu; sheet ve kayıt sayfası aynı diyaloğu kullanır.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fireConfetti } from "@/lib/confetti";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { orderService } from "./service";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  onClosed?: () => void;
}

export function OrderManualCloseDialog({ open, onOpenChange, orderId, onClosed }: Props) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const close = () => {
    onOpenChange(false);
    setReason("");
  };
  const closeMut = useMutation({
    mutationFn: ({ id, r }: { id: string; r: string }) => orderService.manualClose(id, r),
    onSuccess: () => {
      toast.success("Sipariş elle kapatıldı.");
      fireConfetti();
      void qc.invalidateQueries({ queryKey: ["orders"] });
      close();
      onClosed?.();
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Siparişi manuel kapat</DialogTitle>
          <DialogDescription>Bu işlem siparişi "Tamamlandı" duruma alır ve audit log'a düşer. Sebep zorunludur.</DialogDescription>
        </DialogHeader>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Örn: müşteri talebi, fire kabul edildi..." autoFocus />
        <DialogFooter>
          <Button variant="outline" onClick={close}>İptal</Button>
          <Button
            disabled={!reason.trim() || closeMut.isPending}
            onClick={() => {
              if (!orderId) return;
              closeMut.mutate({ id: orderId, r: reason.trim() });
            }}
          >
            {closeMut.isPending ? "Kapatılıyor..." : "Kapat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
