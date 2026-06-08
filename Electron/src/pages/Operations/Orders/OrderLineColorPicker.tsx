import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { itemService } from "@/pages/Items/service";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";

interface Props {
  itemId: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Sipariş müşterisi — renkleri picker'da üstte/vurgulu gösterilir. */
  customerId?: string | null;
  disabled?: boolean;
}

export function OrderLineColorPicker({ itemId, value, onChange, customerId, disabled }: Props) {
  const itemQ = useQuery({
    queryKey: ["item-allowed-colors", itemId],
    queryFn: () => itemService.getById(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
  });

  // Ürünün izinli renkleri (boş = sınırsız → tüm katalog aranabilir).
  const allowedColorIds = useMemo(
    () => (itemQ.data?.data?.allowedColors ?? []).map((c) => c.colorId),
    [itemQ.data?.data?.allowedColors],
  );

  if (!itemId) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs italic text-muted-foreground">
        Önce ürün
      </div>
    );
  }

  return (
    <ColorPickerModal
      value={value}
      onChange={onChange}
      customerId={customerId}
      allowedColorIds={allowedColorIds}
      disabled={disabled}
      triggerClassName="h-9"
      placeholder="Renk seç..."
    />
  );
}
