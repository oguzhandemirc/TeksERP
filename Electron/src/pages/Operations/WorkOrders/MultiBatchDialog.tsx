import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type MultiBatchStrategy = "SEPARATE" | "MERGE";
export interface MultiBatchOption { id: string; batchNumber: string; oldest: boolean }

interface Props {
  batches: MultiBatchOption[] | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (strategy: MultiBatchStrategy) => void;
}

/**
 * Seçilen toplar birden çok partiden (409 MULTI_BATCH): varsayılan her parti AYRI sevk (kendi irsaliyesi,
 * hepsi birlikte ya da hiçbiri); birleştirmek açık seçimdir.
 */
export function MultiBatchDialog({ batches, pending, onCancel, onConfirm }: Props) {
  const [choice, setChoice] = useState<MultiBatchStrategy>("SEPARATE");
  const list = batches ?? [];
  const oldest = list.find((b) => b.oldest) ?? list[0];
  const row = (value: MultiBatchStrategy, title: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm">
      <input type="radio" name="multi-batch" className="mt-1" checked={choice === value} onChange={() => setChoice(value)} />
      <span><span className="font-medium">{title}</span><br /><span className="text-muted-foreground">{hint}</span></span>
    </label>
  );
  return (
    <Dialog open={batches !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Birden çok parti</DialogTitle>
          <DialogDescription>{`Seçilen toplar ${list.length} partiden: ${list.map((b) => b.batchNumber).join(", ")}`}</DialogDescription>
        </DialogHeader>
        {row("SEPARATE", `Ayrı sevk (${list.length} irsaliye)`, "Her parti kendi irsaliyesiyle gider; hepsi birlikte ya da hiçbiri.")}
        {row("MERGE", `Birleştir (${oldest?.batchNumber ?? "en eski parti"})`, "Toplar en eski partide birleşir, diğer partiler kapanır.")}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>Vazgeç</Button>
          <Button type="button" disabled={pending} onClick={() => onConfirm(choice)}>Sevk Et</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
