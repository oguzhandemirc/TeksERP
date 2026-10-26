// Süzgeçler: arama (no/müşteri) · müşteri (seçici doğrudan modal) · tarih aralığı (fabrika günü YYYY-AA-GG,
// sunucu `quoteDate` ile karşılaştırır). Hepsi parametre olarak sunucuya gider; panel süzmez.
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { CustomerPickerField } from "@/components/forms/CustomerPickerField";
import { DatePickerInput } from "@/components/forms/DatePickerInput";
import type { QuoteFilter } from "./quote-types";

export function QuoteFilters({ value, onChange }: { value: QuoteFilter; onChange: (f: QuoteFilter) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Teklif no ya da müşteri…" value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} />
      </div>
      <div className="w-full sm:w-64">
        <CustomerPickerField value={value.customerId} onChange={(customerId) => onChange({ ...value, customerId })} clearable placeholder="Tüm müşteriler" />
      </div>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Başlangıç
        <DatePickerInput className="w-40" value={value.from} onChange={(v) => onChange({ ...value, from: v })} aria-label="Başlangıç tarihi" />
      </label>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        Bitiş
        <DatePickerInput className="w-40" value={value.to} onChange={(v) => onChange({ ...value, to: v })} aria-label="Bitiş tarihi" />
      </label>
    </div>
  );
}
