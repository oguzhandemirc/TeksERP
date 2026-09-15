// Satır başına ÖZELLİK seçimi — dar bir düğme + popover.
//
// ⚠️ Grid satırına inline çip şeridi KONULMAZ: `PropertyChipsField` tüm uygun
// özellikleri aynı anda çizer (tasarımı gereği) ve 20 satırlık bir fişte ekran
// okunmaz olurdu. Düğme SAYIYI gösterir — "seçtim mi?" sorusu popover açmadan
// cevaplanır; asıl seçim yüzeyi tek kaynaktan (aynı bileşen) gelir, yoksa
// kumaşın izinli-özellik süzgüsü burada ikinci kez ve farklı yazılırdı.
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PropertyChipsField } from "@/components/forms/PropertyChipsField";

interface Props {
  itemId: string;
  value: string[];
  onChange: (next: string[]) => void;
  "aria-label"?: string;
}

export function LinePropertiesButton({ itemId, value, onChange, "aria-label": ariaLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={ariaLabel}
          variant={value.length > 0 ? "secondary" : "ghost"}
          size="sm"
          className="h-9 w-full justify-center gap-1 px-1"
          // Kumaş seçilmeden özellik sorulamaz (izinli liste kumaştan çözülür).
          disabled={!itemId}
          title={itemId ? "Üretim özellikleri" : "Önce kumaş seçin"}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {value.length > 0 ? value.length : "—"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PropertyChipsField itemId={itemId} value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
