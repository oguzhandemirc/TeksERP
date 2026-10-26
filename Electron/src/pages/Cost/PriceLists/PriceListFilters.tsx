// Süzgeçler: arama · kapsam (genel / müşteri) · döviz · durum çipleri (sayılar sunucunun `ozet`i).
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { cn } from "@/lib/utils";
import { COST_CURRENCIES } from "../shared/CurrencySelect";
import { PRICE_LIST_STATUSES, PRICE_LIST_STATUS_LABEL, type PriceListFilter, type PriceListSummary } from "./pl-types";

interface Props { value: PriceListFilter; onChange: (f: PriceListFilter) => void; summary?: PriceListSummary }

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
      {label} {count !== undefined && <span className="font-semibold tabular-nums">{count}</span>}
    </button>
  );
}

export function PriceListFilters({ value, onChange, summary }: Props) {
  const set = (p: Partial<PriceListFilter>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Liste no ya da adı…" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <div className="flex gap-1" role="group" aria-label="Kapsam">
          <Chip active={value.scope === ""} label="Tüm listeler" onClick={() => set({ scope: "", customerId: null })} />
          <Chip active={value.scope === "genel"} label="Genel" onClick={() => set({ scope: "genel", customerId: null })} />
          <Chip active={value.scope === "customer"} label="Müşteriye özel" onClick={() => set({ scope: "customer" })} />
        </div>
        {value.scope === "customer" && (
          <div className="w-full sm:w-64">
            <CustomerPickerField value={value.customerId} onChange={(customerId) => set({ customerId })} clearable placeholder="Müşteri seç" />
          </div>
        )}
        <select aria-label="Döviz" className="h-9 rounded-md border bg-background px-2 text-sm" value={value.currency} onChange={(e) => set({ currency: e.target.value as PriceListFilter["currency"] })}>
          <option value="">Tüm dövizler</option>
          {COST_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {summary && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Durum özeti">
          <Chip active={!value.status} label="Hepsi" count={summary.toplam} onClick={() => set({ status: "" })} />
          {PRICE_LIST_STATUSES.map((s) => (
            <Chip key={s} active={value.status === s} label={PRICE_LIST_STATUS_LABEL[s]} count={summary[s] ?? 0} onClick={() => set({ status: s })} />
          ))}
        </div>
      )}
    </div>
  );
}
