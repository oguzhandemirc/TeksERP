import { useMemo } from "react";
import { useItemDetail } from "@/pages/Items/useItemDetail";
import { cn } from "@/lib/utils";
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
  /** Kumaşsız satırda renk kutusuna tıklandı — çağıran kumaş alanını gösterir (geçici uyarı). */
  onMissingItem?: () => void;
}

export function OrderLineColorPicker({ itemId, value, onChange, customerId, disabled, triggerClassName, onMissingItem }: Props) {
  // Perf: LineRequiredPropertiesEditor ile aynı kumaşı paylaşan tek cache girdisi
  // (satır başına çift GET yerine tek istek).
  const itemQ = useItemDetail(itemId);

  // Kumaşın izinli renkleri (boş = sınırsız → tüm katalog aranabilir).
  const allowedColorIds = useMemo(
    () => (itemQ.data?.data?.allowedColors ?? []).map((c) => c.colorId),
    [itemQ.data?.data?.allowedColors],
  );

  // ③ Kalıcı "Önce kumaş seçin" rozeti KALKTI: kumaşsız satırda seçici devre dışı GÖRÜNÜMLÜ ama tıklanabilir
  // bir kutu — tıklama çağırana bildirilir (`onMissingItem`), kumaş alanı geçici uyarıyla gösterilir.
  if (!itemId) {
    return (
      <button
        type="button"
        aria-disabled="true"
        aria-label="Renk seç"
        title="Önce kumaş seçin"
        onClick={onMissingItem}
        className={cn("flex h-9 w-full items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 text-sm text-muted-foreground", triggerClassName)}
      >
        <Palette className="h-4 w-4 shrink-0" />
        <span>Renk</span>
      </button>
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
