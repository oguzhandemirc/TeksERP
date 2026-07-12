import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";

interface Props {
  sackId: string;
  /** null = kapalı; dolu = bu topları taşı. */
  rollIds: string[] | null;
  targets: { id: string; sackNo: string }[];
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/** Seçili topları başka depo çuvalına aktar — hedef çuval seçimi (aynı müşteri havuzu). */
export function MoveRollsDialog({ sackId, rollIds, targets, onOpenChange, onDone }: Props) {
  const qc = useQueryClient();
  const open = !!rollIds && rollIds.length > 0;
  const count = rollIds?.length ?? 0;

  const mut = useMutation({
    mutationFn: (targetSackId: string) => sackHubService.moveRollsToSack(sackId, rollIds!, targetSackId),
    onSuccess: (res) => {
      toast.success(res.message ?? `${count} top taşındı`);
      invalidateSackHub(qc);
      onOpenChange(false);
      onDone?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !mut.isPending && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" /> {count} top hangi çuvala aktarılsın?
          </DialogTitle>
          <DialogDescription>Aynı müşterinin depodaki bir çuvalını seçin.</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={mut.isPending}
              onClick={() => mut.mutate(t.id)}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5 disabled:opacity-50"
            >
              <span className="font-mono">{t.sackNo}</span>
              <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          ))}
          {targets.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Aktarılacak başka çuval yok.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
