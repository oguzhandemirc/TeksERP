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
 * butonu tıklanır tıklanmaz kilitlenir.
 *
 * Kilit ASYNC-AWARE: `onConfirm()` bir Promise dönerse kilit promise settle
 * OLANA DEK tutulur (yavaş sunucuda 2.5sn'lik eski sabit timer kilidi erken
 * çözüp ikinci tetiklemeye açık bırakıyordu). Senkron kullanımlarda (Promise
 * dönmeyen) 2.5sn fallback timer aynen kalır — dialog açık kalırsa retry mümkün.
 * `isPending` verilirse o da ayrıca bağlanır (daha hassas). İmza geriye uyumlu.
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
    const result = onConfirm();
    if (result && typeof (result as Promise<void>).then === "function") {
      // Async: kilidi promise settle olana dek tut (reject apiClient toast'una
      // düşer; burada yut ki unhandled rejection üretmesin).
      void (result as Promise<void>).catch(() => {}).finally(() => setLocked(false));
    } else {
      // Senkron kullanım: 2.5sn fallback (dialog açık kalırsa retry açılır).
      unlockTimer.current = setTimeout(() => setLocked(false), 2500);
    }
  };

  const busy = Boolean(isPending) || locked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* pre-line: "yıkıcı işlemde somut liste" onayları \n'li çok satırlı
              description geçer (ör. parti birleştirme sevk dökümü) — tek satırlı
              mevcut kullanımlar etkilenmez. */}
          {description && (
            <DialogDescription className="whitespace-pre-line">{description}</DialogDescription>
          )}
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
