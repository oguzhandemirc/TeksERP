import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { orderService } from "./service";

interface Props {
  customerId: string | null;
  itemId: string;
  colorId: string | null;
  itemName: string;
  colorName: string;
  onChange: (patch: { customerItemName?: string; customerColorName?: string }) => void;
}

export function OrderLineAliasFields({
  customerId,
  itemId,
  colorId,
  itemName,
  colorName,
  onChange,
}: Props) {
  const enabled = Boolean(customerId && itemId);
  const [suggested, setSuggested] = useState<{ item: string | null; color: string | null }>({
    item: null,
    color: null,
  });

  const suggestQ = useQuery({
    queryKey: ["alias-suggest", customerId, itemId, colorId],
    queryFn: () => orderService.suggestAliases(customerId!, itemId, colorId),
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (suggestQ.data?.data) {
      setSuggested({
        item: suggestQ.data.data.itemAlias,
        color: suggestQ.data.data.colorAlias,
      });
    }
  }, [suggestQ.data?.data]);

  if (!enabled) return null;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Input
          className="text-sm"
          placeholder={
            suggested.item
              ? `Önerilen: ${suggested.item}`
              : "Müşterideki ürün adı (opsiyonel)"
          }
          value={itemName}
          onChange={(e) => onChange({ customerItemName: e.target.value })}
        />
        <Input
          className="text-sm"
          placeholder={
            suggested.color
              ? `Önerilen: ${suggested.color}`
              : "Müşterideki renk adı (opsiyonel)"
          }
          value={colorName}
          onChange={(e) => onChange({ customerColorName: e.target.value })}
          disabled={!colorId}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Boş bırakırsanız müşteri tanımındaki ad veya bizdeki ad otomatik kullanılır. Yazarsanız sadece bu sipariş için sabitlenir.
      </p>
    </div>
  );
}
