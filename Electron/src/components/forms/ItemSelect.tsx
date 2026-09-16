// =============================================================================
// ÜRÜN SEÇİCİ KUTUSU — tetik düğmesi + `ItemPickerModal` (alış siparişi · mal kabul kalemi)
// =============================================================================
// Formda küçük açılır liste HİÇ çizilmez: kutuya tıkla → modal (tedarikçi `SupplierSelect modalPicker` emsali).
// Seçilen kayıt listede olmayabilir (düzenleme / siparişten devralma): etiket `getById` ile ayrıca çözülür — kutunun
// boş görünüp state'in dolu olması projede adı konmuş bir yalan sınıfıdır. Önbellek anahtarı `ReferenceSelect` ve
// `useItemTypes` ile AYNI (`["items","ref-select-by-id",id]`): aynı ürün ikinci kez sorulmaz.
// =============================================================================
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ListFilter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { itemService } from "@/pages/Items/service";
import { ITEM_TYPE_LABEL, itemPickerRow, itemTriggerLabel, type ItemPickerRow } from "./itemPicker";
import { ItemPickerModal } from "./ItemPickerModal";

interface Props {
  value: string | null;
  onChange: (itemId: string | null, row: ItemPickerRow | null) => void;
  /** Çağıran satırı biliyorsa (az önce seçti) etiket için sunucuya gidilmez. */
  selected?: ItemPickerRow | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function ItemSelect({ value, onChange, selected, placeholder = "Ürün seç…", disabled, className, "aria-label": ariaLabel }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [picked, setPicked] = useState<ItemPickerRow | null>(null);
  const known = picked?.id === value ? picked : selected?.id === value ? selected : null;
  const byId = useQuery({
    queryKey: ["items", "ref-select-by-id", value],
    queryFn: () => itemService.getById(value as string),
    enabled: Boolean(value) && !known,
    staleTime: 5 * 60_000,
  });
  const row = known ?? (byId.data?.data ? itemPickerRow(byId.data.data) : null);
  const text = value ? (row ? itemTriggerLabel(row) : byId.isError ? "Ürün bulunamadı" : "…") : placeholder;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        aria-label={ariaLabel ?? "Ürün seç (liste)"}
        aria-haspopup="dialog"
        title="Tıkla: bütün ürünler listede — tür, renk, özellik süzgeci ve arama"
        className={cn("w-full min-w-0 justify-between font-normal", !row && "text-muted-foreground")}
        onClick={() => setModalOpen(true)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{text}</span>
          {row && (
            <Badge variant="muted" className="shrink-0 px-1 py-0 text-[10px] font-normal">
              {ITEM_TYPE_LABEL[row.itemType]}
            </Badge>
          )}
        </span>
        <ListFilter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      <ItemPickerModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onPick={(r) => {
          setPicked(r);
          onChange(r.id, r);
        }}
      />
    </div>
  );
}
