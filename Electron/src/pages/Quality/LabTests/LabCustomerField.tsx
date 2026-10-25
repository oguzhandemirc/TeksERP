// K4P-SERT — lab testinin müşterisi (isteğe bağlı): seçilirse sonuç sınırı müşteri spesifikasyonundan çözülür.
import { Label } from "@/components/ui/label";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";

export function LabCustomerField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="space-y-1">
      <Label>Müşteri (isteğe bağlı)</Label>
      <CustomerPickerField clearable value={value} onChange={onChange} placeholder="Müşteri seç…" />
      <p className="text-xs text-muted-foreground">Seçilirse sonuçlar müşterinin spesifikasyonuyla karşılaştırılır (Sertifikalar › Müşteri spesifikasyonları).</p>
    </div>
  );
}
