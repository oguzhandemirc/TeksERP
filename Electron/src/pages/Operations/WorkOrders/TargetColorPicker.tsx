import { useMemo } from "react";
import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { itemService } from "@/pages/Items/service";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";
import type { WorkOrderFormValues } from "./schema";

/**
 * Hedef Renk picker — paylaşılan `ColorPickerModal`'a ince sarmalayıcı.
 * Kumaşın `allowedColors`'ı kısıtlı kümeyi belirler (boş = sınırsız katalog).
 * `customerId` verilirse müşterinin renkleri üstte/vurgulu gösterilir.
 */
export function TargetColorPicker({
  control,
  customerId,
  disabled,
  lockedTooltip,
}: {
  control: Control<WorkOrderFormValues>;
  customerId?: string | null;
  disabled?: boolean;
  lockedTooltip?: string;
}) {
  const targetItemId = useWatch({ control, name: "targetItemId" });

  const itemQ = useQuery({
    queryKey: ["item-allowed-colors", targetItemId],
    queryFn: () => itemService.getById(targetItemId as string),
    enabled: Boolean(targetItemId),
    staleTime: 60_000,
  });

  const allowedColorIds = useMemo(
    () => (itemQ.data?.data?.allowedColors ?? []).map((a) => a.colorId),
    [itemQ.data?.data?.allowedColors],
  );

  if (!targetItemId) {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 text-xs italic text-muted-foreground">
        Önce hedef kumaş seç
      </div>
    );
  }

  return (
    <Controller
      control={control}
      name="targetColorId"
      render={({ field }) => (
        <ColorPickerModal
          value={field.value ?? null}
          onChange={(id) => field.onChange(id)}
          customerId={customerId}
          allowedColorIds={allowedColorIds}
          disabled={disabled}
          lockedTooltip={lockedTooltip}
          label="Hedef Renk"
        />
      )}
    />
  );
}
