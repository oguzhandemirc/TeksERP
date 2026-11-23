// Ezmeler: yapı alanlarıyla aynı liste (devir, randıman, fireler, atkı boyu, levent, çekme, ek kalem) + tarife.
// Boş alan = ürün yapısı / parametre varsayılanı; değer sunucuda uygulanır, kutuda etkin değer soluk görünür.
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { finishingRateService } from "../FinishingRates/service";
import { decToInput, fmtDecFull } from "../shared/format";
import { STRUCTURE_FIELDS } from "../Items/schema";
import type { OverrideForm } from "./calculator-body";
import type { EffectiveDefaults } from "./effective-defaults";

interface Props {
  value: OverrideForm;
  onChange: (k: keyof OverrideForm, v: string) => void;
  rateCode: string;
  onRateCode: (c: string) => void;
  noRateLabel: string;
  flagged: Set<string>;
  defaults?: EffectiveDefaults;
}

const NO_RATE = "__none__";

export function OverrideFields({ value, onChange, rateCode, onRateCode, noRateLabel, flagged, defaults = {} }: Props) {
  const rates = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: () => finishingRateService.listActive() });
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
      {STRUCTURE_FIELDS.map((fd) => {
        const d = defaults[fd.key];
        return (
          <label key={fd.key} className="text-sm" data-field={fd.key}>
            <span className="text-muted-foreground">{fd.label} ({fd.unit})</span>
            <Input aria-label={`${fd.label} (${fd.unit})`} inputMode="decimal"
              placeholder={d != null && d !== "" ? decToInput(d) : "—"} title="Boş bırakılırsa yapı / parametre değeri kullanılır"
              className={cn("mt-1 text-right tabular-nums", flagged.has(fd.key) && "ring-2 ring-destructive")}
              value={value[fd.key]} onChange={(e) => onChange(fd.key, e.target.value)} />
          </label>
        );
      })}
      <label className="col-span-2 text-sm" data-field="finishingRateCode">
        <span className="text-muted-foreground">Fason tarifesi</span>
        <Select value={rateCode || NO_RATE} onValueChange={(v) => onRateCode(v === NO_RATE ? "" : v)}>
          <SelectTrigger aria-label="Fason tarifesi" className={cn("mt-1 w-full", flagged.has("finishingRateCode") && "ring-2 ring-destructive")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_RATE}>{noRateLabel}</SelectItem>
            {(rates.data ?? []).map((r) => <SelectItem key={r.id} value={r.code}>{r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</SelectItem>)}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}
