// =============================================================================
// ETİKETLİ SÜZGEÇ SEÇİCİSİ — tetik metni "Ad: Değer" (kullanıcı kararı 2026-09-17 03:27)
// =============================================================================
// Kapalı seçici yalnız "Tümü" yazmaz, süzgecin ADINI taşır: "Tür: Tümü" · "Tür: İplik".
// Ad öneki sabittir; açılır listede "Tümü" seçeneği kalır. `SelectValue` bilerek yok —
// tetik metnini bu bileşen kurar. Radix boş string değeri kabul etmez: "Tümü" çağıranın
// verdiği sabit değerle taşınır (ör. "ALL"). Bekçi: `ItemsPage.test.tsx` tetik metni kolu.
// =============================================================================
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}

/** Tetik metni — bileşenden bağımsız da ölçülsün diye ayrı. */
export function labeledSelectText(label: string, value: string, options: readonly { value: string; label: string }[]): string {
  return `${label}: ${options.find((o) => o.value === value)?.label ?? value}`;
}

export function LabeledSelect({ label, value, options, onChange, className }: Props) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("h-9 w-auto min-w-[140px] gap-1 text-xs", className)}>
        <span className="truncate">{labeledSelectText(label, value, options)}</span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
