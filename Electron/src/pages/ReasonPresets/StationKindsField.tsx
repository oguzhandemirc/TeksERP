import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useDevereEnabled, useDokumaEnabled } from "@/hooks/usePricingEnabled";
import { stationKindLabel, stationKindLabels, type StationKind } from "@/types/enums";
import { visibleStationKindLabels, type StationKindFlags } from "@/pages/Stations/stationKindVisibility";

/**
 * Seçenekler: istasyon formuyla aynı görünürlük (kapalı modülün türü çizilmez) + zaten seçili olan tür
 * HER ZAMAN listede kalır (gizlemek kaydette sessizce düşürürdü).
 */
export function stationKindOptions(flags: StationKindFlags, selected: readonly string[]): { value: StationKind; label: string }[] {
  const visible = visibleStationKindLabels(flags, null) as Record<string, string>;
  const out = (Object.keys(stationKindLabels) as StationKind[])
    .filter((k) => visible[k] !== undefined || selected.includes(k))
    .map((k) => ({ value: k, label: stationKindLabels[k] }));
  return out;
}

/** Seçim değişimi (saf): işaretlenen eklenir, kaldırılan çıkar; sıra enum sırası (diff gürültüsü olmasın). */
export function toggleStationKind(selected: readonly StationKind[], kind: StationKind, on: boolean): StationKind[] {
  const set = new Set(selected);
  if (on) set.add(kind);
  else set.delete(kind);
  return (Object.keys(stationKindLabels) as StationKind[]).filter((k) => set.has(k));
}

/**
 * Duruş sebebinin İSTASYON TÜRÜ kapsamı — yalnız `MACHINE_STOP` sekmesinde. Boş = her istasyonda listelenir
 * (bugünkü davranış); seçilirse tablet duruş listesinde yalnız o türlerin istasyonlarında çıkar.
 * Görünürlük kararıdır: eski kayıtların kodu geçerli kalır.
 */
export function StationKindsField({ value, onChange }: { value: StationKind[]; onChange: (v: StationKind[]) => void }) {
  const flags = { dokumaEnabled: useDokumaEnabled(), devereEnabled: useDevereEnabled() };
  const options = stationKindOptions(flags, value);
  return (
    <div className="space-y-1.5" data-testid="rp-station-kinds">
      <Label>İstasyon türleri</Label>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.includes(o.value)}
              onChange={(e) => onChange(toggleStationKind(value, o.value, e.target.checked))}
            />
            {o.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Hiçbiri seçilmezse sebep <b>her istasyonda</b> listelenir. Seçilirse tablet duruş listesinde yalnız bu
        türdeki istasyonlarda çıkar (ör. kopuşlar yalnız dokuma tezgahında).
      </p>
    </div>
  );
}

/** Liste satırı rozeti: kapsam doluysa tür adları; boşsa çizilmez (her istasyon). */
export function StationKindsBadge({ value }: { value: readonly string[] | null | undefined }) {
  if (!value || value.length === 0) return null;
  return <Badge variant="outline">{value.map(stationKindLabel).join(" · ")}</Badge>;
}
