import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { relabelService } from "@/pages/Operations/RelabelStation/service";
import { RelabelSpecForm } from "@/pages/Operations/RelabelStation/RelabelSpecForm";
import { RollContextHeader } from "@/pages/Operations/RelabelStation/RollContextHeader";

interface Props {
  /** Düzeltilecek topun id'si — null = kapalı. Barkodsuz açık kumaş da açılır. */
  rollId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Kaydettikten sonra üst detayı tazele. */
  onSaved?: () => void;
}

/**
 * "Düzelt" — topun VERİSİNİ düzelten TEK diyalog (renk / metraj / kalite / en /
 * özellik / kartelalık + gerekiyorsa sebep). Baskı İÇERMEZ; kâğıt işleri "Etiket"
 * diyaloğundadır (2026-07-30 sadeleştirmesi: eskiden "Yeniden Etiketle/Düzenle" ve
 * "Manuel Düzelt" diye iki buton vardı, ikisi de aynı backend motorunu çağırıyordu
 * ve baskı iki ayrı yerde tekrarlanıyordu).
 *
 * Bağlam `rollId` ile çekilir — barkodsuz açık kumaş (fason dönüşü / istasyonda
 * bekleyen top) barkodla bulunamaz; eski "Manuel Düzelt"in tek üstünlüğü buydu.
 * Süpervizör kapsamı (üretimdeki top) sebep + `roll:manual-adjust` ister; bunu
 * RelabelSpecForm kendi içinde yönetir.
 */
export function RollEditDialog({ rollId, onOpenChange, onSaved }: Props) {
  const open = Boolean(rollId);
  const qc = useQueryClient();

  const ctxQuery = useQuery({
    queryKey: ["relabel-context", "roll", rollId],
    queryFn: () => relabelService.getContextByRollId(rollId as string),
    enabled: open,
    staleTime: 0,
  });
  const ctx = ctxQuery.data?.data ?? null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["relabel-context", "roll", rollId] });
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Düzelt</DialogTitle>
          <DialogDescription>
            Topun verisini düzelt — renk, metraj, kalite, en, özellik. Etiket basmak için
            &quot;Etiket&quot; düğmesini kullanın.
          </DialogDescription>
        </DialogHeader>

        {ctxQuery.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : ctxQuery.isError ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-destructive">
            Bağlam alınamadı: {(ctxQuery.error as Error).message}
          </div>
        ) : ctx ? (
          <div className="space-y-4">
            <RollContextHeader ctx={ctx} onClear={() => onOpenChange(false)} showClear={false} />
            <RelabelSpecForm key={ctx.id} ctx={ctx} onSaved={refresh} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
