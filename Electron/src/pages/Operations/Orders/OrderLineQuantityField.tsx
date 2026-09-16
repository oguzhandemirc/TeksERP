// =============================================================================
// MİKTAR + BİRİM — tek kutu grubu (sipariş formu ④, 2026-09-17): input sağında bitişik kompakt Radix Select
// =============================================================================
// Kural aynen (`is-emri.md`): seçilmemişse kalem kartının birimi GÖSTERİLİR ama GÖNDERİLMEZ (`unit === itemUnit`
// → undefined, sunucu kopyalar — tek yazar); kumaş değişince açık seçim sıfırlanır (satır patch'i). MT dışı
// birimde "ölçülmez" ayrı satır DEĞİL: grupta küçük amber nokta + `title` (karşılama metre defterinden ölçülmez).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ITEM_UNIT_CODES, ITEM_UNIT_LABEL, isMeasuredUnit, type ItemUnitCode } from "@/lib/item-unit";
import { itemService } from "@/pages/Items/service";
import { cn } from "@/lib/utils";

export const UNMEASURED_HINT = "Sevk defteri metre tutar; bu satırın karşılaması ölçülmez, sipariş kendiliğinden kapanmaz.";

interface Props {
  itemId: string;
  quantity: number;
  unit: ItemUnitCode | undefined;
  onQuantity: (q: number) => void;
  onUnit: (u: ItemUnitCode | undefined) => void;
  error?: string;
  className?: string;
}

export function OrderLineQuantityField({ itemId, quantity, unit, onQuantity, onUnit, error, className }: Props) {
  const itemQ = useQuery({
    queryKey: ["order-line-item", itemId],
    queryFn: () => itemService.getById(itemId),
    enabled: Boolean(itemId),
    staleTime: 60_000,
  });
  const itemUnit = (itemQ.data?.data as { unit?: string } | undefined)?.unit;
  const effective = (unit ?? itemUnit ?? "MT") as ItemUnitCode;
  const unmeasured = !isMeasuredUnit(effective);
  return (
    <div className={cn("space-y-1", className)}>
      <div className={cn("flex h-9 items-stretch rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring", error && "border-destructive")} data-testid="qty-unit-group" title={unmeasured ? UNMEASURED_HINT : undefined}>
        <Input
          type="number"
          step="0.1"
          min={0}
          placeholder="Miktar"
          aria-label="Miktar"
          className="h-full min-w-0 flex-1 rounded-r-none border-0 text-sm focus-visible:ring-0"
          value={quantity || ""}
          onChange={(e) => onQuantity(Number(e.target.value) || 0)}
        />
        {unmeasured && <span aria-hidden className="my-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
        <Select value={effective} onValueChange={(u) => onUnit(u === itemUnit ? undefined : (u as ItemUnitCode))}>
          <SelectTrigger className="h-full w-16 shrink-0 rounded-l-none border-0 border-l bg-muted/40 px-2 text-xs" aria-label="Birim">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ITEM_UNIT_CODES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {ITEM_UNIT_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
