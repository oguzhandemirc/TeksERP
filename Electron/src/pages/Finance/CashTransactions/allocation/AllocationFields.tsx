// Masraf bağı alanları (D4-H3): hedef türü + seçici (doğrudan modal) + pay %. Kasa formunda ve bağ diyaloğunda ortak.
import { Briefcase, Cog, Wrench } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TERIM } from "@/lib/terim";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import type { WorkOrder } from "@/pages/Operations/WorkOrders/types";
import { workOrderPickerService } from "./allocationApi";
import { TARGET_TYPE_LABEL, shareHint, type AllocationDraft, type AllocationTargetType } from "./allocationRules";

interface Props {
  value: AllocationDraft;
  onChange: (next: AllocationDraft) => void;
  /** Sunucudan gelen kalan pay (bağ diyaloğu); formda yeni masraf için 100. */
  remainingPct?: string;
}

const TYPES: AllocationTargetType[] = ["MACHINE", "WORK_ORDER", "SERVICE_ITEM"];

function TargetPicker({ value, onChange }: Props) {
  const set = (id: string | null) => onChange({ ...value, targetId: id });
  if (value.targetType === "MACHINE") {
    return (
      <EntityPickerModal<Machine> value={value.targetId} onChange={set} service={machineService} queryKey="expense-alloc-machines"
        getLabel={(m) => m.name} getSubLabel={(m) => m.code} icon={Cog} title="Makine seç" placeholder="Makine seç" triggerClassName="w-full" />
    );
  }
  if (value.targetType === "WORK_ORDER") {
    return (
      <EntityPickerModal<WorkOrder> value={value.targetId} onChange={set} service={workOrderPickerService} queryKey="expense-alloc-work-orders"
        sortBy="createdAt" getLabel={(w) => w.workOrderNumber} getSubLabel={(w) => w.targetItem?.name ?? null} icon={Briefcase}
        title={`${TERIM.terbiyeIsEmri.tekil} seç`} placeholder={`${TERIM.terbiyeIsEmri.tekil} seç`} triggerClassName="w-full" />
    );
  }
  return (
    <EntityPickerModal<Item> value={value.targetId} onChange={set} service={itemService} queryKey="expense-alloc-service-items"
      filters={{ itemType: "SERVICE" }} getLabel={(i) => i.name} getSubLabel={(i) => i.code} icon={Wrench}
      title="Hizmet kalemi seç" placeholder="Hizmet kalemi seç" triggerClassName="w-full" />
  );
}

export function AllocationFields({ value, onChange, remainingPct }: Props) {
  const hint = value.targetId ? shareHint(value.sharePct) : null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_8rem]" data-testid="expense-allocation-fields">
      <div>
        <Label className="text-xs">Neye bağlı</Label>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label="Bağ türü">
          {TYPES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={value.targetType === t}
              className={`h-9 rounded-md border px-2 text-sm ${value.targetType === t ? "border-primary bg-primary/10 font-medium" : "bg-background"}`}
              onClick={() => onChange({ ...value, targetType: t, targetId: null })}>
              {TARGET_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-xs">{TARGET_TYPE_LABEL[value.targetType]}</Label>
        <div className="mt-1"><TargetPicker value={value} onChange={onChange} /></div>
      </div>
      <div>
        <Label className="text-xs">Pay (%){remainingPct ? ` · kalan ${remainingPct}` : ""}</Label>
        <Input className="mt-1" inputMode="decimal" aria-label="Pay yüzdesi" value={value.sharePct}
          onChange={(e) => onChange({ ...value, sharePct: e.target.value })} />
        {hint && <p className="mt-1 text-xs text-destructive">{hint}</p>}
      </div>
    </div>
  );
}

/** Kasa formundaki "Bağla" bölümü — boş bırakılırsa masraf bugünkü gibi bağsız yazılır. */
export function ExpenseLinkSection({ value, onChange }: Props) {
  return (
    <fieldset className="rounded-md border px-3 pb-3 pt-1">
      <legend className="px-1 text-xs font-medium">Bağla (isteğe bağlı)</legend>
      <p className="mb-2 text-xs text-muted-foreground">Masraf bir makineye, {TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ya da hizmet kalemine aitse seçin; kârlılıkta doğrudan maliyet olur. Boş bırakılırsa genel giderde kalır.</p>
      <AllocationFields value={value} onChange={onChange} />
    </fieldset>
  );
}
