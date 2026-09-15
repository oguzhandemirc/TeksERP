// =============================================================================
// SEVK HEDEFİ SEÇİCİSİ — "müşteri VARSAYILANI", sevkin fiili hedefi DEĞİL
// =============================================================================
// ⚠️ Etiket bunu SÖYLEMEK ZORUNDA: süzgeç `Customer.defaultDestination` alanına
// bakar. "İhracat" yazan bir liste, ihracat SEVKLERİ sanılırsa rapor yanlış
// okunur — ve bu yanılgı sessizdir, çünkü sayılar tutarlı görünür.
// =============================================================================
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Destination } from "../_hooks/reportAxisFilters";

const ALL = "__all__";

export function DestinationSelect({ id, value, onChange }: { id: string; value: Destination | ""; onChange: (d: Destination | "") => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Müşteri varsayılanı</Label>
      <Select value={value === "" ? ALL : value} onValueChange={(v) => onChange(v === ALL ? "" : (v as Destination))}>
        <SelectTrigger id={id} className="w-52">
          <SelectValue placeholder="Tümü" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tümü</SelectItem>
          <SelectItem value="DOMESTIC">Yurtiçi (müşteri varsayılanı)</SelectItem>
          <SelectItem value="EXPORT">İhracat (müşteri varsayılanı)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
