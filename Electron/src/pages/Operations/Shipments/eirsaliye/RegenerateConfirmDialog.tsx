// İndirilmiş XML'i yeniden üretme onayı — portala yüklenmiş belge ikinci sürümle çatallanmasın.
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RegenerateConfirmDialog({
  open,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[min(32rem,calc(100vw-2rem))] max-w-none">
        <DialogHeader>
          <DialogTitle>XML yeniden üretilsin mi?</DialogTitle>
          <DialogDescription>Aynı numara ve ETTN ile yeni XML sürümü doğar.</DialogDescription>
        </DialogHeader>
        <Callout tone="warning" title="Portala yüklediyseniz yeniden üretmeyin">
          Bu XML daha önce indirildi. Portala yüklediyseniz önce "Portala yükledim" deyin; yüklemediyseniz devam edebilirsiniz.
        </Callout>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Vazgeç</Button>
          <Button onClick={onConfirm} disabled={pending}>Yüklemedim, yeniden üret</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
