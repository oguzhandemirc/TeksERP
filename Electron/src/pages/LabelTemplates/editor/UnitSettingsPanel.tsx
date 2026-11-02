// Etiket Stüdyosu sol sütun — şablonun birim sistemi (Gülkesim S5). Kaydet ile yazılır;
// önizleme kaydedilmemiş seçimi de gösterir (sunucu aynı biçimleyiciyle basar).
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  UNIT_SYSTEM_OPTIONS,
  fromUnitSettings,
  toUnitSettings,
  unitExample,
  type DecimalsChoice,
  type LabelDecimalSep,
  type LabelUnitSettings,
  type LabelUnitSystem,
} from "./unit-settings";

interface Props {
  value: LabelUnitSettings | null;
  onChange: (next: LabelUnitSettings | null) => void;
}

export function UnitSettingsPanel({ value, onChange }: Props) {
  const cur = fromUnitSettings(value);
  const set = (patch: Partial<typeof cur>) => {
    const n = { ...cur, ...patch };
    onChange(toUnitSettings(n.system, n.decimals, n.sep));
  };
  const hint = UNIT_SYSTEM_OPTIONS.find((o) => o.value === cur.system)?.hint;
  return (
    <div className="space-y-2 border-t pt-3">
      <label className="text-xs font-medium text-muted-foreground">Birim sistemi</label>
      <Select value={cur.system} onValueChange={(v) => set({ system: v as LabelUnitSystem })}>
        <SelectTrigger className="h-9 text-xs" aria-label="Birim sistemi"><SelectValue /></SelectTrigger>
        <SelectContent>
          {UNIT_SYSTEM_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Ondalık</label>
          <Select value={cur.decimals} onValueChange={(v) => set({ decimals: v as DecimalsChoice })}>
            <SelectTrigger className="h-8 text-xs" aria-label="Ondalık hane"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto" className="text-xs">Otomatik (en çok 2)</SelectItem>
              {(["0", "1", "2", "3"] as const).map((d) => (
                <SelectItem key={d} value={d} className="text-xs">{d} hane</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">Ayırıcı</label>
          <Select value={cur.sep} onValueChange={(v) => set({ sep: v as LabelDecimalSep })}>
            <SelectTrigger className="h-8 text-xs" aria-label="Ondalık ayırıcı"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="," className="text-xs">Virgül (59,06)</SelectItem>
              <SelectItem value="." className="text-xs">Nokta (59.06)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        {hint} Örnek en: <strong>{unitExample(value)}</strong>. Alan başlıklarını (ör. "Width") elemanın
        başlık kutusuna serbest yazabilirsiniz.
      </p>
    </div>
  );
}
