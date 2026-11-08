// =============================================================================
// HİZMET KARTI SEÇİCİ — tetik düğmesi + modal liste (combobox YOK), kaynak `/api/service-items`
// =============================================================================
// Hizmet kartı ürün kartından ayrı tabloda (D1b): ürün seçicisi (`ItemSelect`) hizmet GÖSTERMEZ, bu seçici de ürün
// göstermez. Fatura satırı · Kalem Fiyatları · sarf normu · masraf payı aynı bileşeni kullanır. Arama/sayfalama
// sunucuda (`EntityPickerModal`); seçili kart listede yoksa etiket id ile ayrıca çözülür.
// =============================================================================
import { Wrench } from "lucide-react";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import { serviceItemService } from "@/pages/Definitions/Services/service";
import type { ServiceItem } from "@/pages/Definitions/Services/types";

interface Props {
  value: string | null;
  onChange: (id: string | null, row: ServiceItem | null) => void;
  /** `isActive: "true"` üstüne (ör. `lifecycleStatus`). */
  filters?: Record<string, string>;
  placeholder?: string;
  nullable?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  triggerClassName?: string;
}

// Liste ekranıyla aynı kök: kart açılıp kapanınca (CrudPage invalidate) seçici de tazelenir.
export const SERVICE_ITEM_PICKER_QUERY_KEY = "service-items";

export function ServiceItemSelect({ value, onChange, filters, placeholder = "Hizmet kartı seç…", nullable, noneLabel, disabled, triggerClassName }: Props) {
  return (
    <EntityPickerModal<ServiceItem>
      value={value}
      onChange={(id, row) => onChange(id, row ?? null)}
      service={serviceItemService}
      queryKey={SERVICE_ITEM_PICKER_QUERY_KEY}
      filters={filters}
      sortBy="name"
      getLabel={(s) => s.name}
      getSubLabel={(s) => s.code}
      icon={Wrench}
      iconClassName="text-primary"
      title="Hizmet kartı seç"
      description="Yalnız hizmet kartları (Tanımlar › Hizmet Kartları). Arayarak daraltın, satıra tıklayınca seçilir."
      placeholder={placeholder}
      nullable={nullable}
      noneLabel={noneLabel}
      disabled={disabled}
      triggerClassName={triggerClassName}
      countLabel="hizmet kartı"
    />
  );
}
