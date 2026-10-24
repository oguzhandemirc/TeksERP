import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GramajChoiceButtons } from "@/components/kursun/GramajChoiceButtons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GramajOption } from "@/lib/kursun-gramaj";
import { kursunDagitimService } from "./service";
import type { KursunDistributionAssignedRow } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: KursunDistributionAssignedRow;
  options: readonly GramajOption[];
}

/**
 * Kâğıt dağıtımın gramajı (KQ-D6) — isteğe bağlı; girilmezse özetlerde "gramaj bilinmiyor".
 * Tamamlanmış/iptal dağıtımda sunucu 409 verir (gramaj donar).
 */
export function GramajDialog({ open, onOpenChange, row, options }: Props) {
  const qc = useQueryClient();
  const [value, setValue] = useState<string | null>(row.propertyValueId ?? null);
  const mut = useMutation({
    mutationFn: () => kursunDagitimService.setGramaj(row.assignmentId, value),
    onSuccess: (res) => {
      toast.success(res.data?.changed === false ? "Gramaj zaten aynı" : "Gramaj kaydedildi");
      void qc.invalidateQueries({ queryKey: ["kursun-bypass"] });
      void qc.invalidateQueries({ queryKey: ["process-summary"] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(row.propertyValueId ?? null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kurşun gramajı</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{row.workOrderNumber}</span> · {row.machineName}. Kâğıtla yürüyen işte
            gramajı tablet basmaz; buradan girilir.
          </DialogDescription>
        </DialogHeader>
        <GramajChoiceButtons options={options} value={value} onChange={setValue} emptyLabel="Bilinmiyor" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
