// Kur alanları: girdide geçen her TRY-dışı para birimi için; öneri (finans kuru) yanında gösterilir, kendiliğinden
// yazılmaz. Boş kur sunucuya gönderilmez → sunucu FX_RATE_MISSING der; 1 VARSAYILMAZ.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Currency } from "@/pages/Finance/service";
import type { CostInputSnap, FxRates } from "./cost-types";
import { decToInput, fmtDecFull, toDecimalText } from "./format";

/**
 * Girdide fiyatı döviz olan para birimleri (TRY hariç) — sıralı, tekil. Motorun kur aradığı HER fiyatlı parça sayılır
 * (B18/1: atkı ücreti ve ek işlem/devere USD iken "kur gerekmez" denmesin).
 */
export function foreignCurrencies(g: CostInputSnap | null | undefined): Currency[] {
  if (!g) return [];
  const warps = [g.warp, ...(g.warpLayers ?? [])].flatMap((w) => (w ? [w.yarn, ...(w.yarns ?? [])] : []));
  const all = [
    ...warps.map((y) => y.price?.currency),
    ...(g.weft?.yarns ?? []).map((y) => y.price?.currency),
    g.finishing?.price?.currency,
    ...(g.processes ?? []).map((p) => p.price?.currency),
    g.loomPick?.rate?.currency,
    ...(g.formulas ?? []).map((f) => f.currency),
  ];
  return [...new Set(all.filter((c): c is Currency => !!c && c !== "TRY"))].sort();
}

/** Form metinleri → gövde: yalnız dolu kurlar (boş kur gövdeye girmez). */
export function fxBody(form: Partial<Record<Currency, string>>): FxRates {
  const out: FxRates = {};
  for (const [k, v] of Object.entries(form)) {
    const d = toDecimalText(v ?? "");
    if (d) out[k as Currency] = d;
  }
  return out;
}

interface Props {
  currencies: Currency[];
  value: Partial<Record<Currency, string>>;
  onChange: (c: Currency, v: string) => void;
  suggestions?: FxRates;
  highlight?: boolean;
  /** Girdi eksik (kart/fiyat bağlı değil): döviz listesi henüz tam değil — "TL" denmez. */
  incomplete?: boolean;
}

export function FxRateInputs({ currencies, value, onChange, suggestions, highlight, incomplete }: Props) {
  if (!currencies.length) {
    const text = incomplete ? "Kur gerekip gerekmediği eksik girdiler tamamlanınca belli olur." : "Girdideki bütün fiyatlar TL — kur gerekmez.";
    return <p className="text-xs text-muted-foreground">{text}</p>;
  }
  return (
    <div className={cn("flex flex-wrap items-end gap-3 rounded-md p-1", highlight && "ring-2 ring-destructive")} data-field="fx">
      {currencies.map((c) => {
        const sug = suggestions?.[c];
        return (
          <label key={c} className="text-sm">
            <span className="text-muted-foreground">1 {c} = ? TL</span>
            <div className="mt-1 flex items-center gap-1">
              <Input aria-label={`${c} kuru`} inputMode="decimal" className="h-8 w-28 text-right tabular-nums" value={value[c] ?? ""} onChange={(e) => onChange(c, e.target.value)} />
              {sug && !value[c] && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(c, decToInput(sug))}>öneri {fmtDecFull(sug)}</Button>
              )}
            </div>
          </label>
        );
      })}
    </div>
  );
}
