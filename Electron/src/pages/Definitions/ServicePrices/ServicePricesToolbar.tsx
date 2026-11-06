// Tablo araç çubuğu: para birimi · müşteri görünümü · yürürlük tarihi (boş = hemen) · gram fiyatından doldur.
import { CalendarClock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { customerService } from "@/pages/Customers/service";
import type { Customer } from "@/pages/Customers/types";
import { fmtDayKey } from "@/lib/factory-time";
import { CURRENCIES } from "../ItemPrices/service";
import type { Currency } from "./service";
import { minFutureDayKey } from "./servicePrices";

interface Props {
  currency: Currency;
  onCurrency: (c: Currency) => void;
  customerId: string | null;
  onCustomer: (id: string | null) => void;
  validFromDay: string | null;
  onValidFromDay: (d: string | null) => void;
  /** null = düğme çizilmez (yazma izni yok ya da tablo yok). */
  onGramFill: (() => void) | null;
}

export function ServicePricesToolbar({
  currency,
  onCurrency,
  customerId,
  onCustomer,
  validFromDay,
  onValidFromDay,
  onGramFill,
}: Props) {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Para birimi</span>
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={currency}
            onChange={(e) => onCurrency(e.target.value as Currency)}
            aria-label="Para birimi"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="flex w-72 items-center gap-2">
          <span className="text-xs text-muted-foreground">Müşteri</span>
          <ReferenceSelect<Customer>
            value={customerId}
            onChange={onCustomer}
            service={customerService}
            queryKey="customers"
            getLabel={(c) => `${c.code} — ${c.name}`}
            placeholder="Genel görünüm"
            nullable
            noneLabel="— Genel görünüm"
          />
        </div>
        <label className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Yürürlük</span>
          <input
            type="date"
            className="h-8 rounded-md border bg-background px-2"
            min={minFutureDayKey()}
            value={validFromDay ?? ""}
            onChange={(e) => onValidFromDay(e.target.value || null)}
            aria-label="Yürürlük tarihi (boş = hemen)"
          />
          {validFromDay && (
            <Button size="sm" variant="ghost" onClick={() => onValidFromDay(null)}>
              Hemen
            </Button>
          )}
        </label>
        {onGramFill && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={onGramFill}>
            <Sparkles className="mr-1 h-4 w-4" /> Gram fiyatından doldur
          </Button>
        )}
      </div>
      {validFromDay && (
        <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-900 dark:text-amber-200">
          Girdiğiniz fiyatlar <strong>{fmtDayKey(validFromDay)}</strong> itibarıyla geçerli olur; o güne kadar
          bugünkü fiyat uygulanır.
        </div>
      )}
    </>
  );
}
