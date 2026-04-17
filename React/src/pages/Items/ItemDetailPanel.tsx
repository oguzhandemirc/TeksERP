import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { itemService } from "@/services/itemService";
import { SlideOverPanel, SlideOverContentLoader } from "@/components/ui/SlideOverPanel";
import { Package } from "lucide-react";
import { itemTypeLabels } from "@/types/enums";
import type { ItemType } from "@/types/enums";

interface ItemDetailPanelProps {
  itemId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ItemDetailPanel({ itemId, isOpen, onClose }: ItemDetailPanelProps) {
  const [activeId, setActiveId] = useState<string | null>(itemId);

  useEffect(() => {
    if (itemId) setActiveId(itemId);
  }, [itemId]);

  const effectiveId = itemId || activeId;

  const { data, isLoading } = useQuery({
    queryKey: ["item-detail", effectiveId],
    queryFn: () => itemService.getById(effectiveId!),
    enabled: !!effectiveId,
  });

  const { data: variantsData, isLoading: isVariantsLoading } = useQuery({
    queryKey: ["item-variants", effectiveId],
    queryFn: () => itemService.getVariants(effectiveId!),
    enabled: !!effectiveId,
  });

  const item = data?.data;
  const variants = variantsData?.data ?? [];

  return (
    <SlideOverPanel
      title={item ? `${item.code} - ${item.name}` : "Stok Kartı Detayı"}
      isOpen={isOpen}
      onClose={onClose}
    >
      {isLoading ? (
        <SlideOverContentLoader />
      ) : !item ? (
        <div className="text-center text-muted-foreground p-6">Stok kartı bulunamadı</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-muted rounded-lg">
              <Package className="h-6 w-6 text-foreground" />
            </div>
            <div>
              <div className="font-semibold text-lg">{item.name}</div>
              <div className="text-sm text-muted-foreground">{item.code}</div>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-sm font-medium">Genel Bilgiler</div>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <span className="text-muted-foreground">Kayıt Türü:</span>
              <span className="font-medium">
                {itemTypeLabels[item.itemType as ItemType] ?? item.itemType}
              </span>
              <span className="text-muted-foreground">Birim:</span>
              <span className="font-medium">{item.unit}</span>
              <span className="text-muted-foreground">Durum:</span>
              <span className="font-medium">{item.isActive ? "Aktif" : "Pasif"}</span>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-sm font-medium">Desen / Varyantlar ({variants.length})</div>
            {isVariantsLoading ? (
              <div className="text-sm text-muted-foreground">Yükleniyor...</div>
            ) : variants.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {variants.map((v) => (
                  <div key={v.id} className="bg-secondary text-secondary-foreground text-xs px-2 py-1 rounded">
                    <span className="font-semibold">{v.code}</span>
                    {v.name && <span className="ml-1 opacity-80">- {v.name}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Bu ürüne ait tanımlı varyant yok.</div>
            )}
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <div>Oluşturulma: {new Date(item.createdAt).toLocaleString("tr-TR")}</div>
            <div>Son Güncelleme: {new Date(item.updatedAt).toLocaleString("tr-TR")}</div>
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}
