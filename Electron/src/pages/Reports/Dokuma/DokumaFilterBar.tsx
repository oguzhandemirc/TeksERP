// =============================================================================
// DOKUMA RAPORU EKSEN SEÇİCİSİ — tek seçim, "Tümü" varsayılan
// =============================================================================
// Varsayılan "Tümü" = BUGÜNKÜ DAVRANIŞ: seçim yapılmadıkça istekte parametre
// yok, rapor bayt bayt eskisi gibi. Seçenekler süzgeçsiz pencere yanıtından
// gelir (gerekçe `dokumaFilters.ts` başlığı).
// =============================================================================
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ALL_OPTION, type FilterOption } from "./dokumaFilters";

interface Props {
  label: string;
  /** `""` = Tümü. */
  value: string;
  options: FilterOption[];
  onChange: (id: string) => void;
  id: string;
}

const ALL_SENTINEL = "__all__";

export function DokumaFilterBar({ label, value, options, onChange, id }: Props) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value === ALL_OPTION ? ALL_SENTINEL : value}
        onValueChange={(v) => onChange(v === ALL_SENTINEL ? ALL_OPTION : v)}
      >
        <SelectTrigger id={id} className="w-64">
          <SelectValue placeholder="Tümü" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_SENTINEL}>Tümü</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
