import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  isPending?: boolean;
  /** Onay butonunu pasifleştir (ör. ön-koşul sağlanmadı) — iptal hâlâ çalışır. */
  confirmDisabled?: boolean;
}

/**
 * K-A1 fix: çift-tık koruması MERKEZÎ — `isPending` opsiyonel olduğundan 10
 * kullanım korumasızdı (yıkıcı onayda hızlı çift tık = çift mutation). Onay
 * butonu tıklanır tıklanmaz kilitlenir; dialog yeniden açılınca veya 2.5sn
 * sonra (onConfirm hata verip dialog açık kaldıysa retry mümkün olsun diye)
 * çözülür. `isPending` verilirse o da ayrıca bağlanır (daha hassas).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel = "İptal",
  destructive,
  onConfirm,
  isPending,
  confirmDisabled,
}: Props) {
  const [locked, setLocked] = useState(false);
  const unlockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) setLocked(false);
    return () => {
      if (unlockTimer.current) clearTimeout(unlockTimer.current);
    };
  }, [open]);

  const handleConfirm = () => {
    if (locked) return;
    setLocked(true);
    if (unlockTimer.current) clearTimeout(unlockTimer.current);
    unlockTimer.current = setTimeout(() => setLocked(false), 2500);
    void onConfirm();
  };

  const busy = Boolean(isPending) || locked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy || confirmDisabled}
            onClick={handleConfirm}
          >
            {busy ? "..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
