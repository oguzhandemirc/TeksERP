// Yeni varyant (ya da "Örnek al" taslağından yeni) — kumaşa bağlı bir iş emri şablonu doğurur (kodu sunucu üretir).
// Varyant kodu (V01) kumaş içinde tekildir (sunucu 409). Boya rengi kumaşın kartela renkleriyle süzülür (T10; sunucu
// da aynı kuralı uygular): kartela boşsa her renk seçilebilir.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import type { DesignVariant } from "@/pages/WeaveDesigns/types";
import type { VariantFabric, VariantBody } from "./variantRecordForm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fabric: VariantFabric;
  /** "Örnek al" taslağı (kimliksiz; varyant kodu boş). */
  draft: Partial<DesignVariant> | null;
  onSubmit: (body: VariantBody) => void | Promise<void>;
  isSubmitting: boolean;
}

export function VariantFormDialog({ open, onOpenChange, fabric, draft, onSubmit, isSubmitting }: Props) {
  const [variantCode, setVariantCode] = useState("");
  const [name, setName] = useState("");
  const [colorId, setColorId] = useState<string | null>(null);
  const [rateCode, setRateCode] = useState("");
  useEffect(() => {
    if (!open) return;
    setVariantCode(draft?.variantCode ?? "");
    setName(draft?.name ?? "");
    setColorId(draft?.color?.id ?? null);
    setRateCode(draft?.finishingRateCode ?? "");
  }, [open, draft]);
  const code = variantCode.trim();
  const submit = () => void onSubmit({
    itemId: fabric.id, variantCode: code, name: name.trim() || `${fabric.name} ${code}`,
    colorId, finishingRateCode: rateCode.trim() || null,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Yeni varyant — {fabric.code}{draft ? " (örnekten)" : ""}</DialogTitle>
          <DialogDescription>
            {fabric.allowedColorIds.length > 0 ? "Boya rengi kumaşın renk kartelasından seçilir." : "Kumaşın renk kartelası boş; her renk seçilebilir."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="vr-code">Varyant kodu *</Label>
            <Input id="vr-code" value={variantCode} maxLength={16} onChange={(e) => setVariantCode(e.target.value)} placeholder="ör. V01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vr-name">Ad</Label>
            <Input id="vr-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={`ör. ${fabric.name} V01`} />
          </div>
          <div className="space-y-1.5">
            <Label>Boya rengi</Label>
            <ColorPickerModal value={colorId} onChange={setColorId} allowedColorIds={fabric.allowedColorIds} placeholder="Renk seç" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vr-rate">Terbiye tarifesi kodu</Label>
            <Input id="vr-rate" value={rateCode} maxLength={32} onChange={(e) => setRateCode(e.target.value)} placeholder="Boş = kumaşın tarifesi" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button disabled={!code || isSubmitting} onClick={submit}>Oluştur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
