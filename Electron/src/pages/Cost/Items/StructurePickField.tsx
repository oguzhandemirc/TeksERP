// SY-D4: ürün yapısında atkı ücreti (ürün ailesi farklıysa; boş = parametre setinin varsayılanı). Ücret ve döviz birlikte.
// Döviz kutusu panelin ortak seçicisi, etiketli (B18/9: yerel select + etiketsiz kutu kalktı).
import { Input } from "@/components/ui/input";
import { OptionalCurrencySelect } from "../shared/CurrencySelect";
import type { PickPair } from "../shared/loom-pick";

export function StructurePickField({ value, onChange, disabled, placeholder = "boş = varsayılan" }: {
  value: PickPair; onChange: (p: PickPair) => void; disabled: boolean; placeholder?: string;
}) {
  return (
    <div className="col-span-2 text-sm" data-field="loomPickRate">
      <span className="block truncate font-medium text-foreground/80">
        Atkı ücreti <span className="font-normal text-muted-foreground">(1 atkı/cm için /m · para birimi)</span>
      </span>
      <span className="mt-1 flex gap-2">
        <Input aria-label="Atkı ücreti" disabled={disabled} inputMode="decimal" placeholder={placeholder}
          className="text-right tabular-nums placeholder:text-muted-foreground/70"
          value={value.rate} onChange={(e) => onChange({ ...value, rate: e.target.value })} />
        <OptionalCurrencySelect label="Atkı ücreti dövizi" disabled={disabled} noneLabel="Varsayılan"
          value={value.currency} onChange={(currency) => onChange({ ...value, currency })} />
      </span>
    </div>
  );
}
