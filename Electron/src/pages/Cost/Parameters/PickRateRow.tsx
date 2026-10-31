// SY-D4: parametre setinde varsayılan atkı ücreti (dokuma atkı ücreti yöntemi) — ücret + döviz birlikte girilir
// ya da birlikte boş bırakılır (sunucu `COST_PICK_RATE_PAIR`). Birim: 1 atkı/cm sıklık için metre başına.
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { COST_CURRENCIES } from "../shared/CurrencySelect";
import { fmtDecFull, toDecimalText } from "../shared/format";
import type { PickPair } from "../shared/loom-pick";
import { paramDiffers } from "./param-fields";
import type { CostParameterSet } from "./service";

interface Props {
  active: CostParameterSet | null;
  /** Taslak değeri; null → taslak sütunu yok. */
  draft: PickPair | null;
  editable: boolean;
  onChange: (p: PickPair) => void;
}

export function PickRateRow({ active, draft, editable, onChange }: Props) {
  const activeText = active?.defaultLoomPickRate != null && active.defaultLoomPickCurrency
    ? `${fmtDecFull(active.defaultLoomPickRate, 4)} ${active.defaultLoomPickCurrency}` : "—";
  const changed = !!draft && !!active && (paramDiffers(active.defaultLoomPickRate, toDecimalText(draft.rate))
    || (active.defaultLoomPickCurrency ?? "") !== draft.currency);
  return (
    <section className={cn("rounded-md border p-3 text-sm", changed && "bg-amber-500/10")} data-testid="pick-rate-row" data-changed={changed || undefined}>
      <h3 className="font-medium">Dokuma — varsayılan atkı ücreti</h3>
      <p className="text-xs text-muted-foreground">
        1 atkı/cm sıklık için metre başına ücret (ör. 0,02 USD). Dokuma maliyeti &quot;atkı ücreti&quot; yöntemindeyken ürün yapısında ücret yoksa bu kullanılır.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground">Yürürlükteki: <span className="tabular-nums text-foreground">{activeText}</span></span>
        {draft && (editable ? (
          <span className="flex items-center gap-2">
            <Input aria-label="Varsayılan atkı ücreti" inputMode="decimal" placeholder="boş"
              className={cn("h-8 w-28 text-right tabular-nums", changed && "border-amber-500")}
              value={draft.rate} onChange={(e) => onChange({ ...draft, rate: e.target.value })} />
            <select aria-label="Atkı ücreti dövizi" className="h-8 rounded-md border bg-background px-2"
              value={draft.currency} onChange={(e) => onChange({ ...draft, currency: e.target.value as PickPair["currency"] })}>
              <option value="">—</option>
              {COST_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </span>
        ) : (
          <span className="tabular-nums">Taslak: {draft.rate ? `${draft.rate} ${draft.currency}` : "—"}</span>
        ))}
      </div>
    </section>
  );
}
