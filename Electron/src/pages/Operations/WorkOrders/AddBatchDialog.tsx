import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListChecks, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RollPickerDialog } from "@/components/operations/roll-picker/RollPickerDialog";
import type { PickedRoll } from "@/components/operations/roll-picker/pickable-rolls";
import { toastServerSuccess } from "@/lib/serverNotes";
import { workOrderService } from "./service";
import { addBatchError, addBatchPreview, addBatchScopes, slotAfterFailure, tokenFor, type TokenSlot } from "./addBatchModel";
import type { WorkOrder } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wo: Pick<WorkOrder, "id" | "workOrderNumber" | "targetItemId" | "steps">;
}

/**
 * Parti Ekle (hareket defteri D8, tasarım §6.5) — seçilen stok topları bu iş emrinde YENİ parti olur
 * ve rotanın ilk adımından başlar. Kabul kuralı ve son söz sunucuda; ret satır satır burada görünür.
 */
export function AddBatchDialog({ open, onOpenChange, wo }: Props) {
  const [rolls, setRolls] = useState<PickedRoll[]>([]);
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [rejects, setRejects] = useState<{ barcode: string; reason: string }[]>([]);
  const firstStep = [...(wo.steps ?? [])].sort((a, b) => a.stepSequence - b.stepSequence)[0];
  const barcodes = rolls.map((r) => r.barcode).filter((b): b is string => !!b);

  const save = useAddBatchSave(wo.id, () => {
    setRolls([]);
    setReason("");
    setRejects([]);
    onOpenChange(false);
  }, setRejects);

  const unlabeled = rolls.length - barcodes.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Parti Ekle — {wo.workOrderNumber}</DialogTitle>
          <DialogDescription>Seçilen toplar bu iş emrinde YENİ parti olur ve rotanın ilk adımından başlar.</DialogDescription>
        </DialogHeader>
        <Button type="button" variant="outline" className="w-fit gap-1" onClick={() => setPickerOpen(true)}>
          <ListChecks className="h-4 w-4" /> Top Seç
        </Button>
        <SelectedRolls rolls={rolls} onRemove={(id) => setRolls((x) => x.filter((y) => y.id !== id))} />
        {rolls.length > 0 ? <p className="rounded-md bg-muted px-3 py-2 text-sm">{addBatchPreview(rolls, firstStep?.station?.name ?? null)}</p> : null}
        {unlabeled > 0 ? <p className="text-sm text-warning">{unlabeled} topun barkodu yok — önce etiket basın; Parti Ekle barkodla çalışır.</p> : null}
        {rejects.map((r) => <p key={r.barcode} className="text-sm text-destructive">{`${r.barcode} — ${r.reason}`}</p>)}
        <Textarea placeholder="Sebep (isteğe bağlı) — ör. ek sipariş, eksik kalan metraj" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={barcodes.length === 0 || unlabeled > 0 || save.isPending} onClick={() => save.mutate({ barcodes, reason: reason.trim() })}>{`Parti Ekle (${rolls.length})`}</Button>
        </DialogFooter>
        <RollPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title="Top Seç"
          description="Ham stok ya da bitmiş depodaki serbest toplar — iş emrinin kumaşında."
          scopes={addBatchScopes(wo.targetItemId ?? null)}
          excludeIds={rolls.map((r) => r.id)}
          onConfirm={(picked) => { setRolls((x) => [...x, ...picked]); setRejects([]); }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Seçilen toplar — satır satır, çıkarılabilir. */
function SelectedRolls({ rolls, onRemove }: { rolls: PickedRoll[]; onRemove: (id: string) => void }) {
  return (
    <div className="max-h-[36vh] overflow-auto rounded-md border">
      {rolls.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Henüz top seçilmedi.</p> : rolls.map((r) => (
        <div key={r.id} className="flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0">
          <span className="min-w-0 flex-1 truncate">{r.itemName}{r.colorName ? ` · ${r.colorName}` : ""}</span>
          <span className="font-mono text-xs text-muted-foreground">{r.barcode ?? "—"}</span>
          <span className="w-20 text-right tabular-nums">{r.qty} m</span>
          <button type="button" aria-label={`${r.barcode ?? r.id} çıkar`} onClick={() => onRemove(r.id)}><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}

/** Kaydet — istek anahtarı mantıksal deneme başına; ret listesi ve mesaj diyalogda. */
function useAddBatchSave(woId: string, onSaved: () => void, onRejects: (r: { barcode: string; reason: string }[]) => void) {
  const qc = useQueryClient();
  const slot = useRef<TokenSlot | null>(null);
  return useMutation({
    mutationFn: ({ barcodes, reason }: { barcodes: string[]; reason: string }) => {
      slot.current = tokenFor(slot.current, barcodes, () => crypto.randomUUID());
      return workOrderService.addBatch(woId, { clientToken: slot.current.token, rollBarcodes: barcodes, ...(reason ? { reason } : {}) });
    },
    onSuccess: (res) => {
      slot.current = null;
      toastServerSuccess(res, "Parti eklendi");
      for (const key of [["work-order-detail", woId], ["work-order-branches", woId], ["work-orders"]]) void qc.invalidateQueries({ queryKey: key });
      onSaved();
    },
    onError: (err) => {
      slot.current = slotAfterFailure(slot.current, err);
      const { message, rejects } = addBatchError(err);
      onRejects(rejects);
      // eslint-disable-next-line yerel/mutation-onerror-toast -- addBatch `suppressErrorToast` taşır; genel tost kapalı, ret burada basılır
      toast.error(message);
    },
  });
}
