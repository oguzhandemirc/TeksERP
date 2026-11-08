// Fason F7b — "Ana hammaddeyi kim verdi?" (bu fabrikanın bakışı). Düğme grubu (combobox yok); "Bilinmiyor" = null = bugünkü.
// Değer yalnız bilgi + satış tevkifatı önerisine girdi; vergi niteliğini mali müşavir belirler.
import { cn } from "@/lib/utils";
import { MaterialProvider, materialProviderLabels } from "@/types/enums";

interface Props {
  value: MaterialProvider | null;
  onChange: (next: MaterialProvider | null) => void;
  disabled?: boolean;
}

const OPTIONS: Array<{ value: MaterialProvider | null; label: string }> = [
  { value: null, label: "Bilinmiyor" },
  { value: MaterialProvider.CUSTOMER, label: "Müşteri" },
  { value: MaterialProvider.US, label: "Bu fabrika" },
  { value: MaterialProvider.MIXED, label: "Karışık" },
];

const CHOICE =
  "min-h-9 flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export function MaterialProvidedByField({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Ana hammaddeyi kim verdi">
        {OPTIONS.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              title={o.value ? materialProviderLabels[o.value] : "Bilgi yok — bugünkü davranış"}
              onClick={() => onChange(o.value)}
              className={cn(CHOICE, active ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-muted")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Bilgi amaçlı. Ana hammaddeyi bu fabrika verdiyse satış faturasında tevkifat önerilmez; nihai karar mali müşavirindir.
      </p>
    </div>
  );
}
