import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FINANCE_CURRENCIES as CURRENCIES } from "@/pages/Customers/customerFinance";
import type { Currency } from "./service";
import type { KursunGramForm } from "./cariKursunGram";
import { KursunGramPriceHistory } from "@/components/kursun/KursunGramPriceHistory";

/** oie-a: müşteriye özel kurşun gram fiyatı; `null` (fason / eski backend) → çizilmez. */
export function CariKursunGramField({ value, onChange, error, cariId }: { value: KursunGramForm | null; onChange: (v: KursunGramForm) => void; error?: string; cariId?: string }) {
  if (!value) return null;
  return (
    <div className="col-span-2" data-testid="cari-kursun-gram">
      <Label className="text-xs" htmlFor="cari-kursun-gram-price">
        Kurşun gram fiyatı (1 gr/m başına metre fiyatı)
      </Label>
      <div className="mt-1 flex gap-2">
        <Input
          id="cari-kursun-gram-price"
          className="w-40"
          inputMode="decimal"
          placeholder="İstasyon fiyatı"
          value={value.price}
          onChange={(e) => onChange({ price: e.target.value, currency: value.currency })}
        />
        <select
          aria-label="Gram fiyatı para birimi"
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={value.currency}
          onChange={(e) => onChange({ price: value.price, currency: e.target.value as Currency })}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Boş bırakılırsa kurşun istasyonunun gram fiyatı kullanılır. Metre fiyatı = gramaj (gr/m) × gram fiyatı.
      </p>
      {error && <p className="mt-1 text-xs font-medium text-destructive">{error}</p>}
      {cariId && <KursunGramPriceHistory owner={{ kind: "cari", id: cariId }} />}
    </div>
  );
}
