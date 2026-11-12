// "Norm gir / Normu değiştir" — kalem seçiciler DOĞRUDAN modal (combobox yok). Yeni sürüm şu andan itibaren geçerli.
// Token MANTIKSAL DENEME başına (`useAttemptToken`); sunucunun 409 cümlesi diyalogda kalır.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import { ServiceItemSelect } from "@/components/forms/ServiceItemSelect";
import { useAttemptToken } from "@/lib/attemptToken";
import { apiErrorText } from "@/lib/api-error";
import { decToInput, toDecimalText } from "../shared/format";
import { consumableNormService, type ConsumableNorm, type NormBasis } from "./service";
import { CONSUMABLE_NORM_NOTE_MAX } from "./schema";
import { NormBasisField, NormVariantField } from "./NormBasisFields";

type Picked = { id: string; code: string; name: string; unit?: string };

// Hizmet kartı ayrı tabloda (`/api/service-items`) — ürün seçicisi hizmet göstermez; kilitli normda konu değişmez.
function ServiceField({ locked, value, onChange }: { locked: boolean; value: Picked | null; onChange: (p: Picked | null) => void }) {
  if (locked) {
    return (
      <Button variant="outline" className="mt-1 w-full justify-start" disabled>
        {value ? `${value.code} — ${value.name}` : "—"}
      </Button>
    );
  }
  return (
    <ServiceItemSelect
      value={value?.id ?? null}
      onChange={(id, row) => onChange(id && row ? { id: row.id, code: row.code, name: row.name, unit: row.unit } : null)}
      triggerClassName="mt-1"
    />
  );
}

export function ConsumableNormDialog({ onClose, current }: { onClose: () => void; current?: ConsumableNorm | null }) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [service, setService] = useState<Picked | null>(current?.serviceItem ?? null);
  const [consumable, setConsumable] = useState<Picked | null>(current ? { ...current.consumableItem, unit: current.unit } : null);
  const [pickConsumable, setPickConsumable] = useState(false);
  const [qty, setQty] = useState(decToInput(current?.qtyPerM));
  const [note, setNote] = useState("");
  const [basis, setBasis] = useState<NormBasis>(current?.basis ?? "PER_METER");
  const [variantId, setVariantId] = useState<string | null>(current?.propertyValueId ?? null);
  const qtyText = toDecimalText(qty);
  const save = useMutation({
    mutationFn: () => {
      const values = { qtyPerM: qtyText!, basis, note: note.trim() || null, clientToken: attempt.token() };
      return current
        ? consumableNormService.change(current.id, values)
        : consumableNormService.create({ serviceItemId: service!.id, consumableItemId: consumable!.id, propertyValueId: variantId }, values);
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
            Hizmetin bir metresi ya da tamburdan çıkan bir topu için harcanan sarf (ör. kurşun ipi, poşet). Yeni norm şu andan itibaren geçerli; eskisi damgalı kalır.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Hizmet kartı</span>
            <ServiceField locked={locked} value={service} onChange={setService} />
          </div>
          <div>
            <span className="text-muted-foreground">Sarf kalemi</span>
            <Button variant="outline" className="mt-1 w-full justify-start" disabled={locked} onClick={() => setPickConsumable(true)}>
              {consumable ? `${consumable.code} — ${consumable.name}` : "Sarf kalemi seç…"}
            </Button>
          </div>
          <NormVariantField value={variantId} onChange={setVariantId} locked={locked} />
          <NormBasisField value={basis} onChange={setBasis} />
          <QtyField value={qty} onChange={setQty} unit={consumable?.unit} basis={basis} current={current} />
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
        open={pickConsumable}
        onOpenChange={setPickConsumable}
        allowedTypes={["CONSUMABLE"]}
        onPick={(r) => {
          setConsumable({ id: r.id, code: r.code, name: r.name, unit: r.unit });
          setPickConsumable(false);
        }}
      />
    </Dialog>
  );
}

const perOf = (b: NormBasis | undefined) => (b === "PER_ROLL" ? "top" : "m");

function QtyField(p: { value: string; onChange: (v: string) => void; unit?: string; basis: NormBasis; current?: ConsumableNorm | null }) {
  return (
    <>
      <label>
        <span className="text-muted-foreground">Miktar{p.unit ? ` (${p.unit}/${perOf(p.basis)})` : ""}</span>
        <Input aria-label="Miktar" className="mt-1 text-right tabular-nums" inputMode="decimal" value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      </label>
      <ZeroNormHint />
      {p.current && <p className="text-xs text-muted-foreground">Şu anki: {decToInput(p.current.qtyPerM)} {p.current.unit}/{perOf(p.current.basis)}</p>}
    </>
  );
}

// Sıfır norm açık beyandır; normsuz hizmetle karışmasın diye formda söylenir.
function ZeroNormHint() {
  return (
    <p className="text-xs text-muted-foreground">
      0 girerseniz "bu hizmet sarf kullanmaz" beyanı olur (ör. Tambur): kârlılıkta sarf maliyeti 0 sayılır. Hiç norm girilmeyen hizmet "eksik" görünür.
    </p>
  );
}
