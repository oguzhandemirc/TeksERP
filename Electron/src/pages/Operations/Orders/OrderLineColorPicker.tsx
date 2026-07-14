import { useMemo } from "react";
import { useItemDetail } from "@/pages/Items/useItemDetail";
import { Palette } from "lucide-react";
import { ColorPickerModal } from "@/components/forms/color-picker/ColorPickerModal";

interface Props {
  itemId: string;
  value: string | null;
  onChange: (next: string | null) => void;
  /** Sipariş müşterisi — renkleri picker'da üstte/vurgulu gösterilir. */
  customerId?: string | null;
  disabled?: boolean;
  triggerClassName?: string;
}

export function OrderLineColorPicker({ itemId, value, onChange, customerId, disabled, triggerClassName }: Props) {
  // Perf: LineRequiredPropertiesEditor ile aynı ürünü paylaşan tek cache girdisi
  // (satır başına çift GET yerine tek istek).
  const itemQ = useItemDetail(itemId);

  // Ürünün izinli renkleri (boş = sınırsız → tüm katalog aranabilir).
  const allowedColorIds = useMemo(
    () => (itemQ.data?.data?.allowedColors ?? []).map((c) => c.colorId),
    [itemQ.data?.data?.allowedColors],
  );

  if (!itemId) {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
        <Palette className="h-4 w-4 shrink-0" />
        <span>Önce ürün seçin</span>
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
      triggerClassName={triggerClassName ?? "h-9"}
      placeholder="Renk seç..."
    />
  );
}
