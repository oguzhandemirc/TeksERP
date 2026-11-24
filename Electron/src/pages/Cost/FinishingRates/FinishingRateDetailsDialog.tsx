// Tarifenin fiyat DIŞI alanları (ad · hizmet kartı · not) — yeni sürüm AÇMAZ (`PATCH /api/cost/finishing-rates/:id`).
// Fiyat, baz, para birimi, çekme ve firma salt okunur gösterilir; onlar "Fiyat değiştir" ile yeni sürümdür.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Coins, Tag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { FieldGrid, FormCard, WideFormDialog } from "@/components/forms/WideFormDialog";
import { ServiceItemSelect } from "@/components/forms/ServiceItemSelect";
import { fmtDecFull, fmtPct } from "../shared/format";
import { FINISHING_BASIS_LABEL, finishingBasisUnit, finishingRateService, type FinishingRate } from "./service";
import { FINISHING_MAX } from "./schema";

interface Props { row: FinishingRate; onClose: () => void; onChangePrice: () => void }

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm tabular-nums">{value}</div>
    </div>
  );
}

export function FinishingRateDetailsDialog({ row, onClose, onChangePrice }: Props) {
  const qc = useQueryClient();
  const [name, setName] = useState(row.name);
  const [note, setNote] = useState(row.note ?? "");
  const [serviceItemId, setServiceItemId] = useState<string | null>(row.serviceItemId ?? null);
  const save = useMutation({
    mutationFn: () => finishingRateService.updateDetails(row.id, { name: name.trim(), note: note.trim() || null, serviceItemId }),
    onSuccess: (r) => {
      toast.success(r.message ?? "Tarife bilgileri güncellendi.");
      void qc.invalidateQueries({ queryKey: ["cost-finishing-rates"] });
      onClose();
    },
  });
  const canSave = !!name.trim() && !save.isPending;
  return (
    <WideFormDialog
      open
      size="fit"
      onOpenChange={(o) => !o && onClose()}
      title={`${row.code} — düzenle`}
      description="Ad, hizmet kartı ve not yeni sürüm açmadan değişir. Fiyat için “Fiyat değiştir”i kullanın."
      onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>İptal</Button>
          <Button type="submit" disabled={!canSave}>Kaydet</Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormCard title="Tarife" icon={Tag}>
          <FieldGrid cols={2}>
            <FormField label="Ad" htmlFor="frd-name" required>
              <Input id="frd-name" maxLength={FINISHING_MAX.name} value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Hizmet kartı" info="Fason/devereci faturası taslağı bu kartla gelir. Boşsa satır açıklama satırı olur ve kartı her faturada elle seçersiniz.">
              <ServiceItemSelect value={serviceItemId} onChange={(id) => setServiceItemId(id)} placeholder="Seçilmedi" nullable noneLabel="Hizmet kartı yok" />
            </FormField>
            <FormField label="Not" htmlFor="frd-note" className="sm:col-span-2">
              <Input id="frd-note" maxLength={FINISHING_MAX.note} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </FieldGrid>
        </FormCard>
        <FormCard title="Fiyat" icon={Coins} aside={<Button type="button" size="sm" variant="outline" onClick={onChangePrice}>Fiyat değiştir</Button>}>
          <FieldGrid cols={4}>
            <ReadOnly label="Fason firma" value={row.subcontractor?.name ?? "Genel"} />
            <ReadOnly label="Fiyat bazı" value={FINISHING_BASIS_LABEL[row.basis]} />
            <ReadOnly label="Fiyat" value={`${fmtDecFull(row.pricePerM)} ${row.currency}/${finishingBasisUnit(row.basis)}`} />
            <ReadOnly label="Tipik boy çekmesi" value={fmtPct(row.typicalShrinkPct)} />
          </FieldGrid>
        </FormCard>
      </div>
    </WideFormDialog>
  );
}
