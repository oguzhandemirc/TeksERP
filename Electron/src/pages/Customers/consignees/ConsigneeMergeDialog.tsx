// Etiket alıcısı birleştirme (2026-11-10) — yıkıcı işlem: kaynak mezar taşı olur, canlı topları hedefe döner.
// Önizleme backend'den; hedefe dönecek HER top tek tek listelenir, sevkli/kilitliler sayıyla.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { consigneeService, type ConsigneeRow } from "./consigneeService";

interface Props {
  source: ConsigneeRow;
  /** Aynı müşterinin, kaynak dışındaki alıcıları. */
  candidates: ConsigneeRow[];
  initialTargetId?: string | null;
  onClose: () => void;
  onDone: () => void;
}

export function ConsigneeMergeDialog({ source, candidates, initialTargetId, onClose, onDone }: Props) {
  const [targetId, setTargetId] = useState<string | null>(initialTargetId ?? null);
  const preview = useQuery({
    queryKey: ["consignee-merge-preview", source.id, targetId],
    queryFn: () => consigneeService.mergePreview(source.id, targetId as string),
    enabled: targetId != null,
  });
  const merge = useMutation({
    mutationFn: () => consigneeService.merge(source.id, targetId as string),
    onSuccess: () => {
      toast.success("Etiket alıcıları birleştirildi.");
      onDone();
    },
  });
  const p = preview.data;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="consignee-merge-dialog">
        <DialogHeader>
          <DialogTitle>"{source.name}" alıcısını birleştir</DialogTitle>
          <DialogDescription>Bu alıcı seçtiğin alıcıya katılır; canlı topları onun adıyla etiketlenir. Geri alınmaz.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium">Hangi alıcıya katılsın?</legend>
          {candidates.length === 0 && <p className="text-sm text-muted-foreground">Birleştirilecek başka alıcı yok.</p>}
          {candidates.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
              <input type="radio" name="merge-target" checked={targetId === c.id} onChange={() => setTargetId(c.id)} data-testid={`consignee-merge-target-${c.id}`} />
              {c.name}
              {!c.isActive && <span className="text-xs text-muted-foreground">(pasif)</span>}
            </label>
          ))}
        </fieldset>
        {targetId && preview.isLoading && <Skeleton className="h-20 w-full" />}
        {p && (
          <div className="space-y-2" data-testid="consignee-merge-preview">
            <p className="text-sm">
              {p.rolls.length > 0 ? `${p.rolls.length} canlı top "${p.target.name}" adına döner:` : "Adı değişecek canlı top yok."}
            </p>
            {p.rolls.length > 0 && (
              <ul className="max-h-48 divide-y overflow-y-auto rounded border text-sm">
                {p.rolls.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 px-2 py-1" data-testid="consignee-merge-roll">
                    <span className="font-mono">{r.barcode ?? "barkodsuz"}</span>
                    <span className="text-muted-foreground">{r.meters.toLocaleString("tr-TR")} m{r.printed ? " · etiket yeniden basılmalı" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.untouchedRollCount > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="consignee-merge-untouched">
                {p.untouchedRollCount} sevk edilmiş/kilitli topun basılı adı değişmez.
              </p>
            )}
            {!p.target.isActive && <Callout tone="warning">Hedef alıcı pasif; birleşince yeniden seçilebilir olmaz.</Callout>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button variant="destructive" disabled={!p || merge.isPending} onClick={() => merge.mutate()} data-testid="consignee-merge-confirm">
            Birleştir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
