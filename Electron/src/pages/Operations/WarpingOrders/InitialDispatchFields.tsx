// "Yeni sipariş" penceresi — ilk iplik sevki (D2, isteğe bağlı): plan ipliği başına depo · lot · kg · koli · bobin.
// Sipariş açılınca sevk AYNI işlemde doğar (sunucu elle sevkin kurallarını uygular); boş bırakılırsa sevk yok.
import { Truck } from "lucide-react";
import { FormCard } from "@/components/forms/WideFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/ui/info-popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { emptyInitialLine, fillPlanKg, initialTotalKg, type InitialDrafts, type InitialLineDraft } from "./initial-dispatch-model";
import { fmtKg } from "./order-model";
import { LotPicker, WarehousePicker } from "./YarnSourcePickers";
import { YarnLabel } from "./YarnLabel";

interface Yarn { yarnItemId: string; code: string; name: string; grossKg: string; depoKg: string | null }
const num = "text-right tabular-nums";
const INFO = "Doldurursanız sipariş açılırken devereciye iplik sevki de aynı işlemde açılır (irsaliyesi Sevkler bölümünden basılır). Boş bırakırsanız sevki sonra sipariş sayfasından yaparsınız. Koli ve bobin bilgi amaçlıdır; stok kg ile düşer.";

function LineRow({ y, d, set }: { y: Yarn; d: InitialLineDraft; set: (patch: Partial<InitialLineDraft>) => void }) {
  const cell = (k: "qtyKg" | "packageCount" | "bobbinCount", label: string, w: string) => (
    <TableCell className={`${w} align-top`}>
      <Input aria-label={`${y.code} ilk sevk ${label}`} inputMode={k === "qtyKg" ? "decimal" : "numeric"} placeholder="—" className="h-8 text-right tabular-nums" value={d[k]} onChange={(e) => set({ [k]: e.target.value })} />
    </TableCell>
  );
  return (
    <TableRow>
      <TableCell className="align-top">
        <YarnLabel name={y.name} code={y.code} />
        <span className="block text-xs text-muted-foreground">plan {fmtKg(y.grossKg)} kg{y.depoKg !== null ? ` · depoda ${fmtKg(y.depoKg)} kg` : ""}</span>
      </TableCell>
      <TableCell className="w-44 align-top"><WarehousePicker itemId={y.yarnItemId} code={y.code} value={d.warehouse} onChange={(warehouse) => set({ warehouse })} /></TableCell>
      <TableCell className="w-40 align-top"><LotPicker itemId={y.yarnItemId} code={y.code} value={d.lot} onChange={(lot) => set({ lot })} /></TableCell>
      {cell("qtyKg", "kg", "w-28 min-w-28")}
      {cell("packageCount", "koli", "w-20 min-w-20")}
      {cell("bobbinCount", "bobin", "w-20 min-w-20")}
    </TableRow>
  );
}

export function InitialDispatchFields({ yarns, drafts, onChange }: { yarns: readonly Yarn[]; drafts: InitialDrafts; onChange: (d: InitialDrafts) => void }) {
  const total = initialTotalKg(drafts, yarns.map((y) => y.yarnItemId));
  return (
    <FormCard
      sectionId="initial-dispatch"
      title="İlk iplik sevki"
      icon={Truck}
      note={total > 0 ? `${fmtKg(total)} kg sipariş ile birlikte gider` : "isteğe bağlı — boşsa sevk yok"}
      aside={
        <span className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => onChange(fillPlanKg(drafts, yarns))}>Boş kg'lara plan kadar yaz</Button>
          <InfoPopover label="İlk iplik sevki" desc={INFO} />
        </span>
      }
    >
      <div className="overflow-x-auto" data-testid="wo-initial-dispatch">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>İplik</TableHead>
              <TableHead>Depo</TableHead>
              <TableHead>Lot</TableHead>
              <TableHead className={num}>Sevk kg</TableHead>
              <TableHead className={num}>Koli</TableHead>
              <TableHead className={num}>Bobin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {yarns.map((y) => (
              <LineRow key={y.yarnItemId} y={y} d={drafts[y.yarnItemId] ?? emptyInitialLine()}
                set={(patch) => onChange({ ...drafts, [y.yarnItemId]: { ...(drafts[y.yarnItemId] ?? emptyInitialLine()), ...patch } })} />
            ))}
          </TableBody>
        </Table>
      </div>
    </FormCard>
  );
}
