import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PackageOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";

interface Props {
  sack: { id: string; sackNo: string; rollCount: number; swatchCount: number } | null;
  onOpenChange: (open: boolean) => void;
  onDistributed?: (deleted: boolean) => void;
}

/**
 * "Çuvalı Dağıt" — çuvaldaki TÜM top/kartelaları serbest depoya çıkarır (geri
 * okutulabilir; yıkıcı değil). Opsiyonel: boşalan çuvalı da sil.
 */
export function DistributeSackDialog({ sack, onOpenChange, onDistributed }: Props) {
  const qc = useQueryClient();
  const [alsoDelete, setAlsoDelete] = useState(true);
  const open = !!sack;
  const n = (sack?.rollCount ?? 0) + (sack?.swatchCount ?? 0);

  const mut = useMutation({
    mutationFn: () =>
      alsoDelete ? sackHubService.removeSack(sack!.id, true) : sackHubService.distributeSack(sack!.id),
    onSuccess: () => {
      toast.success(
        alsoDelete
          ? `Çuval ${sack!.sackNo} dağıtıldı ve silindi`
          : `Çuval ${sack!.sackNo} dağıtıldı — içerik depoya döndü`,
      );
      invalidateSackHub(qc);
      onOpenChange(false);
      onDistributed?.(alsoDelete);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageOpen className="h-4 w-4" /> Çuval {sack?.sackNo} dağıtılsın mı?
          </DialogTitle>
          <DialogDescription>
            İçindeki <strong>{n}</strong> top/kartela serbest depoya çıkacak — istenirse tekrar okutulabilir.
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Checkbox checked={alsoDelete} onCheckedChange={(v) => setAlsoDelete(!!v)} />
          Boşalan çuvalı da sil
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            İptal
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "..." : alsoDelete ? "Dağıt & Sil" : "Dağıt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
