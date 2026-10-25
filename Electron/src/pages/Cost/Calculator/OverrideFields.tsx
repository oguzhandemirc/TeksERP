// Ezmeler: yapı alanlarıyla aynı liste (devir, randıman, fireler, atkı boyu, levent, çekme, ek kalem) + tarife.
// Boş alan = ürün yapısı / parametre varsayılanı; değer sunucuda uygulanır.
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { finishingRateService } from "../FinishingRates/service";
import { fmtDecFull } from "../shared/format";
import { STRUCTURE_FIELDS } from "../Items/schema";
import type { OverrideForm } from "./calculator-body";

interface Props {
  value: OverrideForm;
  onChange: (k: keyof OverrideForm, v: string) => void;
  rateCode: string;
  onRateCode: (c: string) => void;
  noRateLabel: string;
  flagged: Set<string>;
}

export function OverrideFields({ value, onChange, rateCode, onRateCode, noRateLabel, flagged }: Props) {
  const rates = useQuery({ queryKey: ["cost-finishing-rates", "active"], queryFn: finishingRateService.listActive });
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
      {STRUCTURE_FIELDS.map((fd) => (
        <label key={fd.key} className="text-sm" data-field={fd.key}>
          <span className="text-muted-foreground">{fd.label} ({fd.unit})</span>
          <Input aria-label={`${fd.label} (${fd.unit})`} inputMode="decimal" placeholder="varsayılan"
            className={cn("mt-1 text-right tabular-nums", flagged.has(fd.key) && "ring-2 ring-destructive")}
            value={value[fd.key]} onChange={(e) => onChange(fd.key, e.target.value)} />
        </label>
      ))}
      <label className="col-span-2 text-sm" data-field="finishingRateCode">
        <span className="text-muted-foreground">Fason tarifesi</span>
        <select aria-label="Fason tarifesi" value={rateCode} onChange={(e) => onRateCode(e.target.value)}
          className={cn("mt-1 h-9 w-full rounded-md border bg-background px-2", flagged.has("finishingRateCode") && "ring-2 ring-destructive")}>
          <option value="">{noRateLabel}</option>
          {(rates.data ?? []).map((r) => <option key={r.id} value={r.code}>{r.code} — {r.name} ({fmtDecFull(r.pricePerM)} {r.currency}/m)</option>)}
        </select>
      </label>
    </div>
  );
}
