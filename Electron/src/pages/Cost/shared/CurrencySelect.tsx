// Maliyet ekranlarının para birimi kutusu — panelin ortak seçicisi (Radix `Select`), yerel <select> değil (B18/13).
import type { Currency } from "@/pages/Finance/service";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const COST_CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

/** Radix boş değer taşımaz: "seçilmedi" bu belirteçle gider, dışarıya "" döner. */
const NONE = "__none";

export function CurrencySelect({ value, onChange, id, label = "Para birimi", className = "", disabled }: {
  value: Currency; onChange: (c: Currency) => void; id?: string; label?: string; className?: string; disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Currency)} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={cn("w-24 shrink-0", className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {COST_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Boş bırakılabilen para birimi (ör. yapının atkı ücreti: boş = parametre setinin dövizi). */
export function OptionalCurrencySelect({ value, onChange, label, disabled, noneLabel = "—" }: {
  value: Currency | ""; onChange: (c: Currency | "") => void; label: string; disabled?: boolean; noneLabel?: string;
}) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : (v as Currency))} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-32 shrink-0"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {COST_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
