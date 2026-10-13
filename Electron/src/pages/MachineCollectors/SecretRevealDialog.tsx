// Kart sırrı penceresi — sır YALNIZ burada, bir kez görünür. Sahibi (sayfa) sırrı yerel state'te tutar ve
// pencere kapanınca siler; sır sorgu önbelleğine, log'a, toast metnine girmez (superadmin.md sır hijyeni).
import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  /** null → pencere kapalı. */
  reveal: { collectorName: string; secret: string } | null;
  onClose: () => void;
}

export function SecretRevealDialog({ reveal, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const close = () => {
    setCopied(false);
    onClose();
  };
  const copy = async () => {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.secret);
      setCopied(true);
    } catch {
      toast.error("Panoya kopyalanamadı — sırrı seçip elle kopyalayın.");
    }
  };
  return (
    <Dialog open={reveal !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Kart sırrı — {reveal?.collectorName}</DialogTitle>
          <DialogDescription>
            Sır yalnız şimdi gösterilir; pencere kapanınca bir daha görüntülenemez. Kartın ayarına girin. Kaybolursa sırrı yenileyin (eski sır o an geçersiz olur).
          </DialogDescription>
        </DialogHeader>
        <code data-testid="collector-secret" className="block select-all break-all rounded-md border bg-muted p-3 font-mono text-sm">
          {reveal?.secret}
        </code>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />} {copied ? "Kopyalandı" : "Kopyala"}
          </Button>
          <Button onClick={close}>Kartın ayarına girdim, kapat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
