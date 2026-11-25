import { Copy, SquareArrowOutUpRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  entityName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTemplate: () => void;
  onOpenCard: () => void;
}

/**
 * Kullanım yerinde paylaşılan kaydı düzenleme isteği: yerinde düzenleme yok (override yalnız tanımın
 * asıl yerinden — kullanıcı 2026-11-25). İki yol: örnek alarak yeni kayıt ya da kart ekranında aç.
 */
export function SharedRecordDialog({ entityName, open, onOpenChange, onTemplate, onOpenCard }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entityName} burada düzenlenmez</DialogTitle>
          <DialogDescription>
            Bu kayıt başka yerlerde de kullanılabilir; buradan değiştirmek hepsini etkiler. Değiştirmek
            için kart ekranında açın (etkilenen kayıtlar orada görünür) ya da örnek alarak yeni kayıt açın.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={onOpenCard}>
            <SquareArrowOutUpRight className="mr-1.5 h-4 w-4" />Kart ekranında aç
          </Button>
          <Button type="button" onClick={onTemplate}>
            <Copy className="mr-1.5 h-4 w-4" />Örnek alarak yeni aç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
