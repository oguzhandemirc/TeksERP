// =============================================================================
// FASON DOKUMA (G1p) — sevk formunda İPLİK satırları: kalem · depo · lot · kg
// =============================================================================
// Backend `yarnLineSchema` ile birebir (`fason-summary.yarnLineToPayload`); birim KG açık.
// Yalnız iplik modülü ETKİN (ticaret ∧ iplik) iken çizilir — kapalı kurulumda alan gövdeye GİRMEZ.
// Lot: kalemin aktif lotları (türetilen bakiyeyle); "Lot yok" AÇIK seçenek (sessiz lotsuz yazım olmasın).
// =============================================================================
import { Plus, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { useMultiWarehouse } from "@/hooks/useWarehouses";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { listYarnLots } from "@/pages/Operations/Yarn/service";
import { YARN_ITEM_FILTER } from "@/pages/Operations/Yarn/YarnFilterBar";
import { NO_LOT } from "@/pages/Operations/WarpBeams/YarnLinesEditor";
import type { YarnLineDraft } from "./fason-summary";

function LotSelect({ itemId, value, onChange }: { itemId: string | null; value: string; onChange: (v: string) => void }) {
  const lots = useQuery({ queryKey: ["yarn", "lots", itemId, "fason-dispatch"], queryFn: () => listYarnLots({ itemId: itemId ?? "", isActive: true, limit: 200 }), enabled: Boolean(itemId) });
  const rows = lots.data?.data ?? [];
  return (
    <Select value={value || NO_LOT} onValueChange={(v) => onChange(v === NO_LOT ? "" : v)} disabled={!itemId}>
      <SelectTrigger className="w-52" aria-label="İplik lotu">
        <SelectValue placeholder="Lot" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LOT}>Lot yok</SelectItem>
        {rows.map((lot) => (
          <SelectItem key={lot.id} value={lot.id}>
            {lot.lotNo} · {lot.balanceKg} kg
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FasonYarnLines({ lines, onChange }: { lines: YarnLineDraft[]; onChange: (lines: YarnLineDraft[]) => void }) {
  const { multiWarehouse, warehouses } = useMultiWarehouse();
  const defaultWh = warehouses[0]?.id ?? "";
  const set = (i: number, patch: Partial<YarnLineDraft>) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const add = () => onChange([...lines, { itemId: null, warehouseId: defaultWh, lotId: "", qtyKg: "" }]);
  return (
    <div className="space-y-2 rounded border p-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">İplik (fasoncuya giden, kg)</span>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> İplik satırı
        </Button>
      </div>
      {lines.length === 0 && <p className="text-xs text-muted-foreground">İplik göndermiyorsanız satır eklemeyin — fasoncu kendi ipliğini kullanıyorsa bu normaldir.</p>}
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <div className="w-64">
            <ReferenceSelect<Item> value={l.itemId} onChange={(v) => set(i, { itemId: v, lotId: "" })} service={itemService} queryKey="items-yarn" getLabel={(it) => `${it.code} — ${it.name}`} placeholder="İplik ara..." extraFilters={YARN_ITEM_FILTER} />
          </div>
          {multiWarehouse && (
            <Select value={l.warehouseId || defaultWh} onValueChange={(v) => set(i, { warehouseId: v })}>
              <SelectTrigger className="w-40" aria-label="Depo">
                <SelectValue placeholder="Depo" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <LotSelect itemId={l.itemId} value={l.lotId} onChange={(v) => set(i, { lotId: v })} />
          <Input type="number" min={0.001} step="0.001" className="w-28" placeholder="kg" aria-label="İplik kg" value={l.qtyKg} onChange={(e) => set(i, { qtyKg: e.target.value })} />
          <Button type="button" size="icon" variant="ghost" aria-label="Satırı sil" onClick={() => onChange(lines.filter((_, k) => k !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
