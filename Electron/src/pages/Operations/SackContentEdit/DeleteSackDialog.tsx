import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import type { SackContentRoll, SackContentSwatch } from "./types";

interface Props {
  sack: { id: string; sackNo: string; rolls: SackContentRoll[]; swatches: SackContentSwatch[] } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

/**
 * Çuval sil. Boşsa düz onay. Doluysa içeriği TEK TEK listeler — yıkıcı-onay kuralı
 * (soyut "N top" yetmez) — onaylanınca toplar/kartelalar serbest depoya döner (withContents).
 */
export function DeleteSackDialog({ sack, onOpenChange, onDeleted }: Props) {
  const qc = useQueryClient();
  const open = !!sack;
  const hasContents = !!sack && (sack.rolls.length > 0 || sack.swatches.length > 0);

  const mut = useMutation({
    mutationFn: () => sackHubService.removeSack(sack!.id, hasContents),
    onSuccess: () => {
      toast.success(`Çuval ${sack!.sackNo} silindi`);
      invalidateSackHub(qc);
      onOpenChange(false);
      onDeleted?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> Çuval {sack?.sackNo} silinsin mi?
          </DialogTitle>
          <DialogDescription>
            {hasContents
              ? "Aşağıdaki toplar/kartelalar serbest depoya geri dönecek, sonra çuval silinecek:"
              : "Bu boş çuval silinecek."}
          </DialogDescription>
        </DialogHeader>

        {hasContents && sack && (
          <div className="rounded-md border">
            <ul className="max-h-56 divide-y overflow-y-auto text-sm">
              {sack.rolls.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="truncate font-mono">{r.barcode ?? "Açık Kumaş"}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {r.item.name}
                    {r.color ? ` · ${r.color.name}` : ""}
                  </span>
                </li>
              ))}
              {sack.swatches.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="truncate font-mono">{s.barcode ?? "Kartela"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">kartela</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button variant="destructive" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "..." : hasContents ? "Boşalt & Sil" : "Sil"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
