// Yeni varyant — kumaşa bağlı bir iş emri şablonu doğurur (kodu sunucu üretir). Varyant kodu (V01) kumaş
// içinde tekildir (sunucu 409); renk seçici doğrudan modal açar.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { toast } from "sonner";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { colorService } from "@/pages/Colors/service";
import type { Color } from "@/pages/Colors/types";
import { createVariant } from "../service";
import type { DesignFabric } from "../types";

export function VariantCreateDialog({ fabric, onClose }: { fabric: DesignFabric; onClose: () => void }) {
  const qc = useQueryClient();
  const [variantCode, setVariantCode] = useState("");
  const [name, setName] = useState("");
  const [colorId, setColorId] = useState<string | null>(null);
  const [rateCode, setRateCode] = useState("");
  const create = useMutation({
    mutationFn: () => createVariant({
      itemId: fabric.id, variantCode: variantCode.trim(), name: name.trim() || `${fabric.name} ${variantCode.trim()}`,
      colorId, finishingRateCode: rateCode.trim() || null,
    }),
    onSuccess: () => {
      toast.success("Varyant oluşturuldu.");
      void qc.invalidateQueries({ queryKey: ["product-recipes"] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Yeni varyant — {fabric.code}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="vr-code">Varyant kodu *</Label>
            <Input id="vr-code" value={variantCode} maxLength={16} onChange={(e) => setVariantCode(e.target.value)} placeholder="V01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vr-name">Ad</Label>
            <Input id="vr-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={`${fabric.name} V01`} />
          </div>
          <div className="space-y-1.5">
            <Label>Boya rengi</Label>
            <EntityPickerModal<Color>
              value={colorId}
              onChange={setColorId}
              service={colorService}
              queryKey="colors-variant"
              getLabel={(c) => c.name}
              getSubLabel={(c) => c.code}
              icon={Palette}
              nullable
              noneLabel="Renk yok"
              title="Varyant rengi seç"
              placeholder="Renk seç"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vr-rate">Terbiye tarifesi kodu</Label>
            <Input id="vr-rate" value={rateCode} maxLength={32} onChange={(e) => setRateCode(e.target.value)} placeholder="Boş = kumaşın tarifesi" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button disabled={!variantCode.trim() || create.isPending} onClick={() => create.mutate()}>Oluştur</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
