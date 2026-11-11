// Sipariş satırı tolerans % kutusu (K4) — satırın alt çubuğunda küçük, isteğe bağlı; boş = fabrika ayarı.
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseTolerancePct } from "./lineTolerance";

export function OrderLineToleranceField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const { error } = parseTolerancePct(value);
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      Tolerans %
      <Input
        className={cn("h-7 w-24 text-xs", error && "border-destructive")}
        inputMode="decimal"
        placeholder="Fabrika ayarı"
        aria-label="Tolerans %"
        aria-invalid={error ? true : undefined}
        title={error ?? undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <span className="text-destructive" role="alert">{error}</span>}
    </label>
  );
}
