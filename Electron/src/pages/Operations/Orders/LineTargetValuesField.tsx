// =============================================================================
// SİPARİŞ SATIRI HEDEF DEĞER ALANI (SY-F2, tasarım §7.8) — seçili bayrağın çeşidi ("Kuşak markası: ZEBRA")
// =============================================================================
// Birkaç değer olduğundan açılır liste yerine doğrudan düğme dizisi (UI tercihi: combobox yok).
// Satırda çeşidi olan bayrak yoksa HİÇ çizilmez → dokuma/Adnan Şahin satırı bugünküyle aynı görünür.
// =============================================================================
import { Button } from "@/components/ui/button";
import { setTargetValue, type TargetValueItem, type VariantCatalog } from "./lineTargetValues";

interface Props {
  flagIds: readonly string[];
  catalog: VariantCatalog;
  value: readonly TargetValueItem[];
  onChange: (next: TargetValueItem[]) => void;
}

export function LineTargetValuesField({ flagIds, catalog, value, onChange }: Props) {
  const variants = flagIds.map((id) => catalog.get(id)).filter((v): v is NonNullable<typeof v> => Boolean(v));
  if (variants.length === 0) return null;
  return (
    <div className="flex basis-full flex-col gap-1" data-testid="line-target-values">
      {variants.map((v) => {
        const selected = value.find((t) => t.propertyId === v.propertyId)?.valueId ?? null;
        const pick = (valueId: string | null) => onChange(setTargetValue(value, v.propertyId, valueId));
        return (
          <div key={v.propertyId} className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={v.name}>
            <span className="text-xs text-muted-foreground">{v.name}:</span>
            <Button type="button" size="sm" role="radio" aria-checked={selected === null} variant={selected === null ? "default" : "outline"} className="h-7 text-xs" onClick={() => pick(null)}>
              Seçilmedi
            </Button>
            {v.options.map((o) => (
              <Button key={o.id} type="button" size="sm" role="radio" aria-checked={selected === o.id} variant={selected === o.id ? "default" : "outline"} className="h-7 text-xs" onClick={() => pick(o.id)}>
                {o.name}
              </Button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
