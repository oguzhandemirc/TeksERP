import { Controller, type Control } from "react-hook-form";
import { Package } from "lucide-react";
import { itemService } from "@/pages/Items/service";
import type { Item } from "@/pages/Items/types";
import { EntityPickerModal } from "@/components/forms/entity-picker/EntityPickerModal";
import type { WorkOrderFormValues } from "./schema";

/**
 * Hedef Kumaş picker — genel arama modalı (EntityPickerModal) üzerine RHF
 * Controller sarmalı. Yüzlerce kumaş için sunucu cursor araması + sonsuz kaydırma.
 */
export function TargetItemPicker({
  control,
  onItemChange,
  disabled,
  lockedTooltip,
}: {
  control: Control<WorkOrderFormValues>;
  /** Kumaş değiştiğinde renk ve özellikleri sıfırlamak için. */
  onItemChange?: () => void;
  /** Düzenleme kilitliyse (örn. sevk yapılmış). */
  disabled?: boolean;
  /** disabled true ise neden — hover'da tooltip. */
  lockedTooltip?: string;
}) {
  return (
    <Controller
      control={control}
      name="targetItemId"
      render={({ field }) => (
        <EntityPickerModal<Item>
          value={field.value ?? null}
          onChange={(id) => {
            field.onChange(id);
            onItemChange?.();
          }}
          service={itemService}
          queryKey="items-wo-target"
          getLabel={(i) => i.name}
          getSubLabel={(i) => i.code}
          nullable
          noneLabel="Atanmadı"
          disabled={disabled}
          lockedTooltip={lockedTooltip}
          icon={Package}
          iconClassName="text-primary"
          title="Hedef Kumaş"
          description="Kumaş seç veya aramayla daralt. Atama zorunlu değil."
          placeholder="Atanmadı"
        />
      )}
    />
  );
}
