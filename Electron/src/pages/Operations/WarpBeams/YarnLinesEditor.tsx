// =============================================================================
// İPLİK SATIRLARI — brüt çıkış (cağlığa yüklenen) · dip iadesi (AYRI satır, sebep zorunlu)
// =============================================================================
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Warehouse } from "@/pages/Warehouses/types";
import type { ReasonPreset } from "@/pages/ReasonPresets/service";
import type { YarnLotRow } from "@/pages/Operations/Yarn/service";

/** "Lot yok" seçeneği — sessiz lotsuz yazım olmasın, operatör AÇIKÇA seçsin (1e H-A3). */
export const NO_LOT = "__no_lot__";

export interface YarnLineDraft {
  warehouseId: string;
  qtyKg: string;
  reasonCode: string;
  /** Devere Faz 2: tedarikçi lotu; "" = lot yok (lotsuz satır — sunucu uyarır, lotRequired açıksa reddeder). */
  lotId: string;
}

interface Props {
  title: string;
  lines: YarnLineDraft[];
  onChange: (lines: YarnLineDraft[]) => void;
  warehouses: Warehouse[];
  multiWarehouse: boolean;
  /** Dip iadesinde zorunlu; çıkışta çizilmez. */
  reasons?: ReasonPreset[];
  /** Çözgü ipliğinin aktif lotları (türetilen bakiyeyle); yoksa lot seçici çizilmez. */
  lots?: YarnLotRow[];
  /** `devere.lotRequired` açık: "Lot yok" seçeneği çizilmez. */
  lotRequired?: boolean;
}

export function YarnLinesEditor({ title, lines, onChange, warehouses, multiWarehouse, reasons, lots, lotRequired }: Props) {
  const set = (i: number, patch: Partial<YarnLineDraft>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const add = () => onChange([...lines, { warehouseId: warehouses[0]?.id ?? "", qtyKg: "", reasonCode: "", lotId: "" }]);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Satır
        </Button>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {multiWarehouse && (
            <Select value={l.warehouseId} onValueChange={(v) => set(i, { warehouseId: v })}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Depo" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {lots && (
            <Select value={l.lotId || NO_LOT} onValueChange={(v) => set(i, { lotId: v === NO_LOT ? "" : v })}>
              <SelectTrigger className="w-56" aria-label="İplik lotu">
                <SelectValue placeholder="Lot" />
              </SelectTrigger>
              <SelectContent>
                {!lotRequired && <SelectItem value={NO_LOT}>Lot yok</SelectItem>}
                {lots.map((lot) => (
                  <SelectItem key={lot.id} value={lot.id}>
                    {lot.lotNo} · {lot.balanceKg} kg
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input type="number" min={0.001} step="0.001" className="w-32" placeholder="kg" value={l.qtyKg} onChange={(e) => set(i, { qtyKg: e.target.value })} />
          {reasons && (
            <Select value={l.reasonCode} onValueChange={(v) => set(i, { reasonCode: v })}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Dip nereye gitti? (zorunlu)" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button type="button" size="icon" variant="ghost" aria-label="Satırı kaldır" onClick={() => onChange(lines.filter((_, k) => k !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
