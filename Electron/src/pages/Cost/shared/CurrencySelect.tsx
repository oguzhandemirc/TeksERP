import type { Currency } from "@/pages/Finance/service";

export const COST_CURRENCIES: Currency[] = ["TRY", "USD", "EUR", "GBP", "RUB"];

export function CurrencySelect({ value, onChange, id, label = "Para birimi" }: { value: Currency; onChange: (c: Currency) => void; id?: string; label?: string }) {
  return (
    <select id={id} aria-label={label} className="h-9 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value as Currency)}>
      {COST_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}
