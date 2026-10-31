// "Norm gir / Normu değiştir" — kalem seçiciler DOĞRUDAN modal (combobox yok). Yeni sürüm şu andan itibaren geçerli.
// Token MANTIKSAL DENEME başına (`useAttemptToken`); sunucunun 409 cümlesi diyalogda kalır.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorText } from "@/lib/api-error";
import { decToInput, toDecimalText } from "../shared/format";
import { consumableNormService, type ConsumableNorm } from "./service";
import { CONSUMABLE_NORM_NOTE_MAX } from "./schema";

type Picked = { id: string; code: string; name: string; unit?: string };

export function ConsumableNormDialog({ onClose, current }: { onClose: () => void; current?: ConsumableNorm | null }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [service, setService] = useState<Picked | null>(current?.serviceItem ?? null);
  const [consumable, setConsumable] = useState<Picked | null>(current ? { ...current.consumableItem, unit: current.unit } : null);
  const [picker, setPicker] = useState<"service" | "consumable" | null>(null);
  const [qty, setQty] = useState(decToInput(current?.qtyPerM));
  const [note, setNote] = useState("");
  const qtyText = toDecimalText(qty);
  const save = useMutation({
    mutationFn: () => {
      const values = { qtyPerM: qtyText!, note: note.trim() || null, clientToken: attempt.token() };
      return current ? consumableNormService.change(current.id, values) : consumableNormService.create(service!.id, consumable!.id, values);
    },
    onSuccess: (r) => {
      attempt.onSuccess();
      toast.success(r.message ?? "Sarf normu kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-consumable-norms"] });
      onClose();
    },
    onError: (e) => attempt.onFailure(e),
  });
  const locked = !!current;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? "Sarf normunu değiştir" : "Hizmet sarf normu"}</DialogTitle>
          <DialogDescription>
            Hizmetin bir metresi için harcanan sarf miktarı (ör. kurşun dikiminde ip). Yeni norm şu andan itibaren geçerli; eskisi damgalı kalır. Norm gerçek tüketim değildir.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Hizmet kalemi</span>
            <Button variant="outline" className="mt-1 w-full justify-start" disabled={locked} onClick={() => setPicker("service")}>
              {service ? `${service.code} — ${service.name}` : "Hizmet kalemi seç…"}
            </Button>
          </div>
          <div>
            <span className="text-muted-foreground">Sarf kalemi</span>
            <Button variant="outline" className="mt-1 w-full justify-start" disabled={locked} onClick={() => setPicker("consumable")}>
              {consumable ? `${consumable.code} — ${consumable.name}` : "Sarf kalemi seç…"}
            </Button>
          </div>
          <label>
            <span className="text-muted-foreground">Metre başına miktar{consumable?.unit ? ` (${consumable.unit}/m)` : ""}</span>
            <Input aria-label="Metre başına miktar" className="mt-1 text-right tabular-nums" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </label>
          {current && <p className="text-xs text-muted-foreground">Şu anki: {decToInput(current.qtyPerM)} {current.unit}/m</p>}
          <label>
            <span className="text-muted-foreground">Not</span>
            <Input className="mt-1" maxLength={CONSUMABLE_NORM_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {save.isError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">
              {apiErrorText(save.error, "Sarf normu kaydedilemedi.")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!service || !consumable || !qtyText || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
      <ItemPickerModal
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        allowedTypes={picker === "service" ? ["SERVICE"] : ["CONSUMABLE"]}
        onPick={(r) => {
          const p = { id: r.id, code: r.code, name: r.name, unit: r.unit };
          if (picker === "service") setService(p);
          else setConsumable(p);
          setPicker(null);
        }}
      />
    </Dialog>
  );
}
