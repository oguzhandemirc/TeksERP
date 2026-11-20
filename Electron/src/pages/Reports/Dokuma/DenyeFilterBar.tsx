// Denye Sapması süzgeç şeridi (tarih şeridi düzende ayrıca gömülür): iplik · devereci · köken. Seçiciler doğrudan
// modal açar; boş = Tümü (istekten anahtar düşer). Köken bugün tek değerli — tartıyı yalnız fason devere kabulü yazar.
import { Handshake, Package } from "lucide-react";
import { Label } from "@/components/ui/label";
import { InfoPopover } from "@/components/ui/info-popover";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { SubcontractorCategoryPicker } from "@/components/forms/SubcontractorCategoryPicker";
import { DEVERE_CATEGORY_CODE } from "@/lib/subcontractor-category-codes";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";

const YARN_ONLY = { itemType: "YARN" } as const;

interface Props {
  yarnItemId: string;
  subcontractorId: string;
  onYarn: (id: string, label?: string) => void;
  onSubcontractor: (id: string, label?: string) => void;
}

export function DenyeFilterBar({ yarnItemId, subcontractorId, onYarn, onSubcontractor }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <div className="w-64 space-y-1">
        <Label>İplik</Label>
        <EntityPickerModal<Item>
          value={yarnItemId || null}
          onChange={(id, it) => onYarn(id ?? "", it?.name)}
          service={itemService}
          queryKey="items-denier-report-yarn"
          filters={YARN_ONLY}
          getLabel={(it) => it.name}
          getSubLabel={(it) => it.code}
          icon={Package}
          title="İplik seç"
          placeholder="Tümü"
          nullable
          noneLabel="Tümü"
        />
      </div>
      <div className="w-64 space-y-1">
        <Label>Devereci</Label>
        <SubcontractorCategoryPicker
          value={subcontractorId || null}
          onChange={(id, s) => onSubcontractor(id ?? "", s?.name)}
          categoryCode={DEVERE_CATEGORY_CODE}
          queryKey="subcontractors-denier-report"
          getLabel={(x) => x.name}
          icon={Handshake}
          title="Devereci seç"
          placeholder="Tümü"
          nullable
          noneLabel="Tümü"
        />
      </div>
      <div className="space-y-1">
        <Label className="flex items-center gap-1">
          Köken
          <InfoPopover desc="Levent tartısını (brüt + dara) bugün yalnız fason devere dönüş kabulü yazar; içeride sarılan leventin tartısı geldiğinde bu süzgeç açılır." />
        </Label>
        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">Fason devere</div>
      </div>
    </div>
  );
}
