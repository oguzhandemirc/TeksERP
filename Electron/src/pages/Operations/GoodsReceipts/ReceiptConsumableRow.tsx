// =============================================================================
// MAL KABUL — SARF satırı: Sarf kalemi · Miktar · Birim · Birim Fiyat (top doğmaz; sarf stok defterine GİRİŞ)
// =============================================================================
// Yalnız `consumable.stockEnabled` açıkken çizilir (kapalıyken backend sarf satırını 400 ile reddeder).
// Birim kalem kartından okunur (`Item.unit`; sarf defteri miktarı kartın biriminde tutar) — önbellek anahtarı
// `ItemSelect`/`useItemTypes` ile AYNI, ikinci GET atılmaz. Adet YOK: sarf toplu miktardır, tek defter satırı.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { ItemSelect } from "@/components/forms/ItemSelect";
import { itemService } from "@/pages/Items/service";
import { unitLabel } from "@/lib/item-unit";
import { cellLabel, receiptLineGridCols } from "./receiptLineColumns";
import { RowActions, type RowProps } from "./ReceiptFabricRow";

const L = (i: number) => cellLabel("CONSUMABLE", i);

export function ReceiptConsumableRow({ line: l, onPatch, onDuplicate, onRemove, removeDisabled }: RowProps) {
  const item = useQuery({
    queryKey: ["items", "ref-select-by-id", l.itemId],
    queryFn: () => itemService.getById(l.itemId),
    enabled: Boolean(l.itemId),
    staleTime: 5 * 60_000,
  });
  const unit = l.itemId ? unitLabel(item.data?.data?.unit) : "—";
  return (
    <div className={`grid ${receiptLineGridCols("CONSUMABLE")} items-center gap-2`} data-testid="receipt-line-consumable">
      <ItemSelect value={l.itemId || null} onChange={(v) => onPatch({ itemId: v ?? "" })} placeholder="Sarf ara (kuşak, şerit, ip)..." aria-label={L(0)} allowedTypes={["CONSUMABLE"]} />
      <Input type="number" min={0} step="0.001" placeholder="0" aria-label={L(1)} title="Sarf miktarı — kalem kartının biriminde" value={l.initialQty || ""} onChange={(e) => onPatch({ initialQty: Number(e.target.value) })} />
      <span className="text-center text-sm text-muted-foreground" aria-label={L(2)}>{unit}</span>
      <Input type="number" min={0} step="0.0001" placeholder="—" aria-label={L(3)} value={l.unitPrice ?? ""} onChange={(e) => onPatch({ unitPrice: e.target.value ? Number(e.target.value) : null })} />
      <RowActions onDuplicate={onDuplicate} onRemove={onRemove} removeDisabled={removeDisabled} />
    </div>
  );
}
