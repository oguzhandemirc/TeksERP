// SY-D4: ürün yapısında atkı ücreti (ürün ailesi farklıysa; boş = parametre setinin varsayılanı). Ücret ve döviz birlikte.
import { Input } from "@/components/ui/input";
import { COST_CURRENCIES } from "../shared/CurrencySelect";
import type { PickPair } from "../shared/loom-pick";

export function StructurePickField({ value, onChange, disabled }: { value: PickPair; onChange: (p: PickPair) => void; disabled: boolean }) {
  return (
    <label className="text-sm" data-field="loomPickRate">
      <span className="text-muted-foreground">Atkı ücreti (1 atkı/cm için /m)</span>
      <span className="mt-1 flex gap-2">
        <Input aria-label="Atkı ücreti" disabled={disabled} inputMode="decimal" placeholder="varsayılan" className="text-right tabular-nums"
          value={value.rate} onChange={(e) => onChange({ ...value, rate: e.target.value })} />
        <select aria-label="Atkı ücreti dövizi" disabled={disabled} className="h-9 rounded-md border bg-background px-2"
          value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value as PickPair["currency"] })}>
          <option value="">—</option>
          {COST_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </span>
    </label>
  );
}
