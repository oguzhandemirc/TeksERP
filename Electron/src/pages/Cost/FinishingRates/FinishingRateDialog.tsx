// Tarife yaz/değiştir — geniş form iskeleti (kısa alanlar ızgarada, açıklama ⓘ); fason firma seçici DOĞRUDAN modal
// (EntityPickerModal); kod sabit kalırsa yeni sürüm olur. Devere ücreti de buradan yazılır (terbiye/boya/apre ile aynı tablo).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Handshake, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid, FormCard, WideFormDialog } from "@/components/forms/WideFormDialog";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { ServiceItemSelect } from "@/components/forms/ServiceItemSelect";
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
  const [serviceItemId, setServiceItemId] = useState<string | null>(current?.serviceItemId ?? null);
  const priceText = toDecimalText(price);
  const save = useMutation({
    mutationFn: () =>
      finishingRateService.change({
        code: code.trim(), name: name.trim(), subcontractorId: subId, basis, currency, pricePerM: priceText!,
        typicalShrinkPct: toDecimalText(shrink), note: note.trim() || null, serviceItemId,
      }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Tarife kaydedildi.");
      void qc.invalidateQueries({ queryKey: ["cost-finishing-rates"] });
      void qc.invalidateQueries({ queryKey: ["cost-items"] });
      onClose();
    },
  });
  const canSave = !!code.trim() && !!name.trim() && !!priceText && !save.isPending;
  return (
    <WideFormDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={current ? `${current.name} — yeni fiyat` : "Yeni tarife"}
      description="Aynı kodla kaydetmek yeni sürüm yazar; eski tarife damgalı kalır. Kayıtlı standart maliyetler değişmez."
      onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button type="submit" disabled={!canSave}>Kaydet</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormCard title="Tarife" icon={Tag}>
          <FieldGrid cols={4}>
            <FormField label="Ad" htmlFor="fr-name" required>
              <Input id="fr-name" maxLength={FINISHING_MAX.name} value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Kod" htmlFor="fr-code" required info={current ? "Kod sabittir: değişiklik aynı tarifenin yeni sürümüdür." : undefined}>
              <Input id="fr-code" maxLength={FINISHING_MAX.code} disabled={!!current} value={code} onChange={(e) => setCode(e.target.value)} />
            </FormField>
            <FormField label="Fason firma" info="Boş bırakılırsa tarife firmaya bağlı olmaz (genel fiyat). Devere ücreti için devereciyi seçin; sipariş formu ücreti buradan doldurur.">
              <EntityPickerModal<Subcontractor> value={subId} onChange={setSubId} service={subcontractorService} queryKey="subcontractors-finishing-rate"
                getLabel={(s) => s.name} icon={Handshake} title="Fason firma seç" placeholder="Seçilmedi" nullable />
            </FormField>
            <FormField label="Hizmet kartı" info="Fason/devereci faturası taslağı bu kartla gelir (devere: Ham metre tarifesi metre ücretine, Kilo tarifesi kg ücretine). Boşsa satır açıklama satırı olur ve kartı her faturada elle seçersiniz.">
              <ServiceItemSelect value={serviceItemId} onChange={(id) => setServiceItemId(id)} placeholder="Seçilmedi" nullable noneLabel="Hizmet kartı yok" />
            </FormField>
          </FieldGrid>
        </FormCard>
        <FormCard title="Fiyat" icon={Coins}>
          <FieldGrid cols={4}>
            <FormField label="Fiyat bazı">
              <Select value={basis} onValueChange={(v) => setBasis(v as FinishingBasis)}>
                <SelectTrigger aria-label="Fiyat bazı"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FINISHING_BASIS_LABEL) as FinishingBasis[]).map((b) => <SelectItem key={b} value={b}>{FINISHING_BASIS_LABEL[b]}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label={basis === "KG" ? "Fiyat (kilo başına)" : "Fiyat (metre başına)"} htmlFor="fr-price" required>
              <div className="flex gap-2">
                <Input id="fr-price" className="text-right tabular-nums" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                <CurrencySelect value={currency} onChange={setCurrency} />
              </div>
            </FormField>
            <FormField label="Tipik boy çekmesi (%)" htmlFor="fr-shrink" info="Standart maliyette mamul metreye geçişte kullanılır; devere ücretinde boş bırakılabilir.">
              <Input id="fr-shrink" className="text-right tabular-nums" inputMode="decimal" value={shrink} onChange={(e) => setShrink(e.target.value)} />
            </FormField>
            <FormField label="Not" htmlFor="fr-note">
              <Input id="fr-note" maxLength={FINISHING_MAX.note} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </FieldGrid>
        </FormCard>
      </div>
    </WideFormDialog>
  );
}
