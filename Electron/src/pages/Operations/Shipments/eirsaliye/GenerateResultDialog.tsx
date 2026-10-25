// XML üretimi doğrulamadan dönünce hataları ALAN ALAN listeler (sunucu cümlesi aynen).
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EIrsaliyeValidationIssue } from "./types";

export function GenerateResultDialog({
  issues,
  onClose,
  onEditFields,
}: {
  issues: EIrsaliyeValidationIssue[] | null;
  onClose: () => void;
  /** Taşıma alanı eksikse doğrudan düzenleme penceresine geçiş (yetki varsa). */
  onEditFields?: () => void;
}) {
  return (
    <Dialog open={issues !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(36rem,calc(100vw-2rem))] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>e-İrsaliye üretilemedi</DialogTitle>
          <DialogDescription>Aşağıdaki bilgiler eksik ya da hatalı. Düzeltip yeniden üretin; numara tüketilmedi.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm" data-testid="eirsaliye-validation">
          {(issues ?? []).map((i, idx) => (
            <li key={`${i.field}-${idx}`} className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5">
              {i.message}
            </li>
          ))}
        </ul>
        <DialogFooter>
          {onEditFields && (
            <Button variant="outline" onClick={onEditFields}>
              Taşıma bilgilerini düzelt
            </Button>
          )}
          <Button onClick={onClose}>Tamam</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
