// Süzgeçler: arama · kapsam (genel / müşteri) · döviz · durum çipleri (sayılar sunucunun `ozet`i).
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { cn } from "@/lib/utils";
import { COST_CURRENCIES } from "../shared/CurrencySelect";
import { PRICE_LIST_STATUSES, PRICE_LIST_STATUS_LABEL, type PriceListFilter, type PriceListSummary } from "./pl-types";
import { SelectChip } from "@/components/data-table/filter-row/SelectChip";

interface Props { value: PriceListFilter; onChange: (f: PriceListFilter) => void; summary?: PriceListSummary }

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("rounded-full border px-3 py-1 text-xs transition-colors", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted")}>
      {label} {count !== undefined && <span className="font-semibold tabular-nums">{count}</span>}
    </button>
  );
}

const SCOPE_OPTIONS = [{ value: "genel", label: "Genel" }, { value: "customer", label: "Müşteriye özel" }] as const;
const CURRENCY_OPTIONS = COST_CURRENCIES.map((c) => ({ value: c, label: c }));

export function PriceListFilters({ value, onChange, summary }: Props) {
  const set = (p: Partial<PriceListFilter>) => onChange({ ...value, ...p });
  return (
    <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Ara…" title="Liste no ya da adı" aria-label="Fiyat listesi ara: liste no ya da adı" value={value.q} onChange={(e) => set({ q: e.target.value })} />
        </div>
        <SelectChip id="pl-scope" label="Kapsam" value={value.scope || null} options={SCOPE_OPTIONS}
          onChange={(v) => set(v === "customer" ? { scope: "customer" } : { scope: v ?? "", customerId: null })} />
        {value.scope === "customer" && (
          <div className="w-full sm:w-64">
            <CustomerPickerField value={value.customerId} onChange={(customerId) => set({ customerId })} clearable placeholder="Müşteri seç" />
          </div>
        )}
        <SelectChip id="pl-currency" label="Döviz" value={value.currency || null} options={CURRENCY_OPTIONS}
          onChange={(v) => set({ currency: (v ?? "") as PriceListFilter["currency"] })} />
      {summary && (
        // M16: durum çipleri ayrı satır değil — aynı filtre satırında ince ayraçla.
        <div className="flex flex-wrap gap-2 border-l pl-2" role="group" aria-label="Durum özeti">
          <Chip active={!value.status} label="Hepsi" count={summary.toplam} onClick={() => set({ status: "" })} />
          {PRICE_LIST_STATUSES.map((s) => (
            <Chip key={s} active={value.status === s} label={PRICE_LIST_STATUS_LABEL[s]} count={summary[s] ?? 0} onClick={() => set({ status: s })} />
          ))}
        </div>
      )}
    </div>
  );
}
