// "Fiyat değiştir" — iplik seçici DOĞRUDAN modal (combobox yok). Kaydetmek eski fiyatı damgalar, yenisini yazar.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ItemPickerModal } from "@/components/forms/ItemPickerModal";
import type { Currency } from "@/pages/Finance/service";
import { CurrencySelect } from "../shared/CurrencySelect";
import { decToInput, toDecimalText } from "../shared/format";
import { yarnPriceService, type YarnCostPrice } from "./service";
import { YARN_NOTE_MAX } from "./schema";

interface Props { open: boolean; onOpenChange: (o: boolean) => void; current?: YarnCostPrice | null }

export function YarnPriceDialog({ open, onOpenChange, current }: Props) {
  const qc = useQueryClient();
  const [yarn, setYarn] = useState<{ id: string; code: string; name: string } | null>(current?.yarnItem ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [currency, setCurrency] = useState<Currency>(current?.currency ?? "TRY");
  const [price, setPrice] = useState(decToInput(current?.pricePerKg));
  const [note, setNote] = useState("");
  const priceText = toDecimalText(price);
  const save = useMutation({
    mutationFn: () => yarnPriceService.change({ yarnItemId: yarn!.id, currency, pricePerKg: priceText!, note: note.trim() || null }),
    onSuccess: (r) => {
      toast.success(r.message ?? "İplik fiyatı kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-yarn-prices"] });
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>İplik maliyet fiyatı</DialogTitle>
          <DialogDescription>Yeni fiyat bugünden geçerli olur; eski fiyat silinmez, geçmişte damgalı kalır. Kayıtlı standart maliyetler değişmez.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">İplik</span>
            <Button variant="outline" className="mt-1 w-full justify-start" disabled={!!current} onClick={() => setPickerOpen(true)}>
              {yarn ? `${yarn.code} — ${yarn.name}` : "İplik seç…"}
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1">
              <span className="text-muted-foreground">Fiyat (kg başına)</span>
              <Input className="mt-1 text-right tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </label>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </div>
          {current && <p className="text-xs text-muted-foreground">Şu anki fiyat: {decToInput(current.pricePerKg)} {current.currency}/kg</p>}
          <label>
            <span className="text-muted-foreground">Not</span>
            <Input className="mt-1" maxLength={YARN_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!yarn || !priceText || save.isPending} onClick={() => save.mutate()}>Kaydet</Button>
        </DialogFooter>
      </DialogContent>
      <ItemPickerModal open={pickerOpen} onOpenChange={setPickerOpen} allowedTypes={["YARN"]} onPick={(r) => { setYarn({ id: r.id, code: r.code, name: r.name }); setPickerOpen(false); }} />
    </Dialog>
  );
}
