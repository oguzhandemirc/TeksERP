// Tarife yaz/değiştir — fason firma seçici DOĞRUDAN modal (EntityPickerModal); kod sabit kalırsa yeni sürüm olur.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Handshake } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { subcontractorService } from "@/pages/Subcontractors/service";
import type { Subcontractor } from "@/pages/Subcontractors/types";
import type { Currency } from "@/pages/Finance/service";
import { CurrencySelect } from "../shared/CurrencySelect";
import { decToInput, toDecimalText } from "../shared/format";
import { FINISHING_BASIS_LABEL, finishingRateService, type FinishingBasis, type FinishingRate } from "./service";
import { FINISHING_MAX } from "./schema";

interface Props { onClose: () => void; current: FinishingRate | null }

export function FinishingRateDialog({ onClose, current }: Props) {
  const qc = useQueryClient();
  const [code, setCode] = useState(current?.code ?? "");
  const [name, setName] = useState(current?.name ?? "");
  const [subId, setSubId] = useState<string | null>(current?.subcontractorId ?? null);
  const [basis, setBasis] = useState<FinishingBasis>(current?.basis ?? "RAW_M");
  const [currency, setCurrency] = useState<Currency>(current?.currency ?? "TRY");
  const [price, setPrice] = useState(decToInput(current?.pricePerM));
  const [shrink, setShrink] = useState(decToInput(current?.typicalShrinkPct));
  const [note, setNote] = useState("");
  const priceText = toDecimalText(price);
  const save = useMutation({
    mutationFn: () =>
      finishingRateService.change({
        code: code.trim(), name: name.trim(), subcontractorId: subId, basis, currency, pricePerM: priceText!,
        typicalShrinkPct: toDecimalText(shrink), note: note.trim() || null,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Tarife kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-finishing-rates"] });
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{current ? `Tarife ${current.code} — yeni fiyat` : "Yeni tarife"}</DialogTitle>
          <DialogDescription>Aynı kodla kaydetmek yeni sürüm yazar; eski tarife damgalı kalır. Kayıtlı standart maliyetler değişmez.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <label><span className="text-muted-foreground">Kod</span>
            <Input className="mt-1" maxLength={FINISHING_MAX.code} disabled={!!current} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <label><span className="text-muted-foreground">Ad</span>
            <Input className="mt-1" maxLength={FINISHING_MAX.name} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="sm:col-span-2">
            <span className="text-muted-foreground">Fason firma (opsiyonel)</span>
            <EntityPickerModal<Subcontractor> value={subId} onChange={setSubId} service={subcontractorService} queryKey="subcontractors-finishing-rate"
              getLabel={(s) => s.name} icon={Handshake} title="Fason firma seç" placeholder="Fason firma seç" nullable />
          </div>
          <label><span className="text-muted-foreground">Fiyat bazı</span>
            <select className="mt-1 h-9 w-full rounded-md border bg-background px-2" value={basis} onChange={(e) => setBasis(e.target.value as FinishingBasis)}>
              {(Object.keys(FINISHING_BASIS_LABEL) as FinishingBasis[]).map((b) => <option key={b} value={b}>{FINISHING_BASIS_LABEL[b]}</option>)}
            </select></label>
          <div className="flex items-end gap-2">
            <label className="flex-1"><span className="text-muted-foreground">{basis === "KG" ? "Fiyat (kilo başına)" : "Fiyat (metre başına)"}</span>
              <Input className="mt-1 text-right tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
          <label><span className="text-muted-foreground">Tipik boy çekmesi (%)</span>
            <Input className="mt-1 text-right tabular-nums" inputMode="decimal" value={shrink} onChange={(e) => setShrink(e.target.value)} /></label>
          <label className="sm:col-span-2"><span className="text-muted-foreground">Not</span>
            <Input className="mt-1" maxLength={FINISHING_MAX.note} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!code.trim() || !name.trim() || !priceText || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
