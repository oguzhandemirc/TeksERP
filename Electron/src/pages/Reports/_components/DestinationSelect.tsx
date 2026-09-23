// =============================================================================
// SİPARİŞ RAPORLARINDA YÖN SEÇİCİSİ — "cari/şube yönü (bugünkü)", sevkin donmuş yönü DEĞİL
// =============================================================================
// ⚠️ Etiket bunu SÖYLEMEK ZORUNDA: süzgeç siparişin şube → cari zincirine (bugünkü
// kart, `reports/_destination.ts`) bakar; kart değişince geçmiş raporun kümesi de
// değişir. "İhracat" yazan liste ihracat SEVKLERİ sanılırsa rapor yanlış okunur.
// =============================================================================
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Destination } from "../_hooks/reportAxisFilters";

const ALL = "__all__";

export function DestinationSelect({ id, value, onChange }: { id: string; value: Destination | ""; onChange: (d: Destination | "") => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Cari/şube yönü (bugünkü)</Label>
      <Select value={value === "" ? ALL : value} onValueChange={(v) => onChange(v === ALL ? "" : (v as Destination))}>
        <SelectTrigger id={id} className="w-52">
          <SelectValue placeholder="Tümü" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Tümü</SelectItem>
          <SelectItem value="DOMESTIC">Yurtiçi (cari/şube yönü)</SelectItem>
          <SelectItem value="EXPORT">İhracat (cari/şube yönü)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
