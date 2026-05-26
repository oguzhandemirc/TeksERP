import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/forms/ConfirmDialog";
import { cn } from "@/lib/utils";
import { orderService } from "./service";

interface Props {
  customerId: string | null;
  itemId: string;
  colorId: string | null;
  itemName: string;
  colorName: string;
  onChange: (patch: { customerItemName?: string; customerColorName?: string }) => void;
}

type ConfirmTarget = "item" | "color" | null;

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
  // Override mode: kullanıcı confirm ile "yine de değiştir" dedi. Edit mode'da
  // line zaten dolu geliyorsa (eski override kayıtlı) otomatik açık başlar.
  const [itemOverride, setItemOverride] = useState(Boolean(itemName));
  const [colorOverride, setColorOverride] = useState(Boolean(colorName));
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);

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

  // Item/color değişince override state'i resetle — yeni satır context'i için
  // kilitli başlasın. Override içinde yazılı value form üzerinden temizlenir.
  useEffect(() => {
    setItemOverride(Boolean(itemName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);
  useEffect(() => {
    setColorOverride(Boolean(colorName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorId]);

  if (!enabled) return null;

  const itemLocked = Boolean(suggested.item) && !itemOverride;
  const colorLocked = Boolean(suggested.color) && !colorOverride;

  const confirmConfig =
    confirmTarget === "item"
      ? {
          title: "Müşteri tanımı var",
          description: `Müşteride bu ürünün kayıtlı adı "${suggested.item}". Sadece bu sipariş için farklı bir ad girmek istiyor musunuz?`,
        }
      : confirmTarget === "color"
        ? {
            title: "Müşteri tanımı var",
            description: `Müşteride bu rengin kayıtlı adı "${suggested.color}". Sadece bu sipariş için farklı bir ad girmek istiyor musunuz?`,
          }
        : null;

  const handleConfirm = () => {
    if (confirmTarget === "item") setItemOverride(true);
    if (confirmTarget === "color") setColorOverride(true);
    setConfirmTarget(null);
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Input
          className={cn(
            "text-sm",
            itemLocked && "cursor-pointer bg-muted/40 text-foreground",
          )}
          placeholder={itemLocked ? (suggested.item ?? "") : "Müşterideki ürün adı (opsiyonel)"}
          value={itemName}
          onChange={(e) => onChange({ customerItemName: e.target.value })}
          readOnly={itemLocked}
          onClick={itemLocked ? () => setConfirmTarget("item") : undefined}
          title={itemLocked ? "Değiştirmek için tıkla" : undefined}
        />
        <Input
          className={cn(
            "text-sm",
            colorLocked && "cursor-pointer bg-muted/40 text-foreground",
          )}
          placeholder={
            colorLocked ? (suggested.color ?? "") : "Müşterideki renk adı (opsiyonel)"
          }
          value={colorName}
          onChange={(e) => onChange({ customerColorName: e.target.value })}
          readOnly={colorLocked}
          onClick={colorLocked ? () => setConfirmTarget("color") : undefined}
          disabled={!colorId}
          title={colorLocked ? "Değiştirmek için tıkla" : undefined}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Müşteride kayıtlı ad varsa alan kilitlidir; üzerine yazmak için tıklayın. Boş bırakırsanız
        kayıtlı ad (yoksa bizdeki ad) kullanılır.
      </p>

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmTarget(null);
        }}
        title={confirmConfig?.title ?? ""}
        description={confirmConfig?.description}
        confirmLabel="Override Et"
        cancelLabel="Vazgeç"
        onConfirm={handleConfirm}
      />
    </div>
  );
}
